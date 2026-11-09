import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  userFindUnique: vi.fn(), vehicleFindFirst: vi.fn(), vehicleFindMany: vi.fn(), auditCreate: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
  user: { findUnique: mock.userFindUnique },
  vehicle: { findFirst: mock.vehicleFindFirst, findMany: mock.vehicleFindMany },
  auditLog: { create: mock.auditCreate },
} }));
vi.mock("@/lib/city-context", () => ({ setCityContext: vi.fn() }));

import { listAdminVehicles, resolveAdminAccess, signAdminToken, verifyAdminToken } from "@/lib/admin-app-auth";
import { requireDriver, signDriverToken, verifyDriverToken } from "@/lib/driver-auth";

const userId = "11111111-1111-4111-8111-111111111111";
const vehicleId = "22222222-2222-4222-8222-222222222222";
const cityId = "33333333-3333-4333-8333-333333333333";
const otherCityId = "44444444-4444-4444-8444-444444444444";

function asUser(overrides: Record<string, unknown> = {}) {
  mock.userFindUnique.mockResolvedValue({ id: userId, fullName: "Asha Admin", role: "ADMIN", isActive: true, cityAssignments: [{ cityId }], ...overrides });
}
function request(token: string, init: { method?: string; vehicle?: string } = {}) {
  return new Request("http://localhost/api/driver/dues", {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, ...(init.vehicle ? { "x-vehicle-id": init.vehicle } : {}) },
  });
}

beforeEach(() => {
  process.env.DRIVER_JWT_SECRET = "x".repeat(40);
  vi.clearAllMocks();
  mock.auditCreate.mockResolvedValue({});
  mock.vehicleFindFirst.mockResolvedValue({ id: vehicleId, cityId });
  asUser();
});

describe("admin and driver tokens are never interchangeable", () => {
  it("an admin token is not a vehicle login, and a vehicle token is not an admin", async () => {
    const admin = await signAdminToken({ userId, role: "ADMIN" });
    const driver = await signDriverToken({ vehicleId, cityId });
    expect(await verifyDriverToken(admin)).toBeNull();
    expect(await verifyAdminToken(driver)).toBeNull();
    expect(await verifyAdminToken(admin)).toEqual({ userId, role: "ADMIN" });
  });

  it("rejects a garbage token", async () => {
    expect(await verifyAdminToken("not.a.token")).toBeNull();
  });
});

describe("resolveAdminAccess", () => {
  it("scopes an admin to their assigned cities and a superadmin to all", async () => {
    expect((await resolveAdminAccess(userId))?.cityIds).toEqual([cityId]);
    asUser({ role: "SUPERADMIN" });
    expect((await resolveAdminAccess(userId))?.cityIds).toBeNull();
  });

  it("refuses a deactivated account and a role that is not an admin", async () => {
    asUser({ isActive: false });
    expect(await resolveAdminAccess(userId)).toBeNull();
    asUser({ role: "USER" });
    expect(await resolveAdminAccess(userId)).toBeNull();
    mock.userFindUnique.mockResolvedValue(null);
    expect(await resolveAdminAccess(userId)).toBeNull();
  });
});

describe("listAdminVehicles", () => {
  it("filters to the admin's cities, but not for a superadmin", async () => {
    mock.vehicleFindMany.mockResolvedValue([]);
    await listAdminVehicles({ userId, fullName: "A", role: "ADMIN", cityIds: [cityId] });
    expect(mock.vehicleFindMany.mock.calls[0][0].where).toMatchObject({ cityId: { in: [cityId] } });
    await listAdminVehicles({ userId, fullName: "S", role: "SUPERADMIN", cityIds: null });
    expect(mock.vehicleFindMany.mock.calls[1][0].where).toEqual({ isActive: true });
  });
});

describe("requireDriver with an admin token", () => {
  it("lets an admin act on a vehicle in their city, and says so", async () => {
    const token = await signAdminToken({ userId, role: "ADMIN" });
    const result = await requireDriver(request(token, { vehicle: vehicleId }));
    expect(result).toMatchObject({ vehicleId, cityId, admin: { userId, role: "ADMIN", name: "Asha Admin" } });
  });

  it("refuses without a vehicle, or for a vehicle outside the admin's cities", async () => {
    const token = await signAdminToken({ userId, role: "ADMIN" });
    expect(await requireDriver(request(token))).toBeNull();
    mock.vehicleFindFirst.mockResolvedValue(null); // the city filter found nothing
    expect(await requireDriver(request(token, { vehicle: vehicleId }))).toBeNull();
    expect(mock.vehicleFindFirst.mock.calls[0][0].where).toMatchObject({ cityId: { in: [cityId] } });
    void otherCityId;
  });

  it("refuses an admin who has since been deactivated, even with a valid token", async () => {
    const token = await signAdminToken({ userId, role: "ADMIN" });
    asUser({ isActive: false });
    expect(await requireDriver(request(token, { vehicle: vehicleId }))).toBeNull();
  });

  it("allows a write and records it as the admin's, before it happens", async () => {
    const token = await signAdminToken({ userId, role: "ADMIN" });
    const result = await requireDriver(request(token, { method: "POST", vehicle: vehicleId }));
    expect(result?.admin?.userId).toBe(userId);
    expect(mock.auditCreate).toHaveBeenCalledTimes(1);
    expect(mock.auditCreate.mock.calls[0][0].data).toMatchObject({ actorId: userId, actorName: "Asha Admin", entityId: vehicleId, action: "ADMIN_APP_POST" });
  });

  it("does not audit a plain read", async () => {
    const token = await signAdminToken({ userId, role: "ADMIN" });
    await requireDriver(request(token, { vehicle: vehicleId }));
    expect(mock.auditCreate).not.toHaveBeenCalled();
  });

  it("refuses the write if it cannot be attributed", async () => {
    const token = await signAdminToken({ userId, role: "ADMIN" });
    mock.auditCreate.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await requireDriver(request(token, { method: "POST", vehicle: vehicleId }))).toBeNull();
  });
});

describe("requireDriver with a vehicle token", () => {
  it("still works exactly as before", async () => {
    const token = await signDriverToken({ vehicleId, cityId });
    expect(await requireDriver(request(token))).toEqual({ vehicleId, cityId });
    expect(mock.userFindUnique).not.toHaveBeenCalled();
  });
});
