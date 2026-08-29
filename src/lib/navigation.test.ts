import { describe, expect, it } from "vitest";
import { appNavigation, visibleNavigationFor } from "@/lib/navigation";

// This filter decides what appears in the sidebar on every screen for every
// user, so it is tested directly rather than only through the one feature that
// currently uses it.

const titles = (role: Parameters<typeof visibleNavigationFor>[0]) =>
  visibleNavigationFor(role).map((item) => item.title);

describe("visibleNavigationFor", () => {
  it("shows a USER every unrestricted screen", () => {
    const visible = titles("USER");

    expect(visible).toContain("Dashboard");
    expect(visible).toContain("Daily Entry");
    expect(visible).toContain("Monthly Bills");
    expect(visible).toContain("Settings");
  });

  it("hides WhatsApp from a USER — it is a city-wide outbound action", () => {
    expect(titles("USER")).not.toContain("WhatsApp");
  });

  it("shows WhatsApp to an ADMIN and a SUPERADMIN", () => {
    expect(titles("ADMIN")).toContain("WhatsApp");
    expect(titles("SUPERADMIN")).toContain("WhatsApp");
  });

  it("fails closed for a null role rather than flashing a restricted link", () => {
    expect(titles(null)).not.toContain("WhatsApp");
    expect(titles(undefined)).not.toContain("WhatsApp");
  });

  it("still shows unrestricted items when there is no role yet", () => {
    expect(titles(null)).toContain("Dashboard");
  });

  it("removes only restricted items — every role sees the same unrestricted set", () => {
    const unrestricted = appNavigation.filter((item) => !item.roles).length;

    expect(titles("USER")).toHaveLength(unrestricted);
    expect(titles(null)).toHaveLength(unrestricted);
    expect(titles("SUPERADMIN").length).toBeGreaterThan(unrestricted);
  });

  it("keeps the declared order, so the sidebar does not reshuffle by role", () => {
    const adminOrder = titles("ADMIN");
    const userOrder = titles("USER");

    expect(userOrder).toEqual(adminOrder.filter((title) => title !== "WhatsApp"));
  });
});
