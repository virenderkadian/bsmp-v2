import { Redirect } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, API_BASE, ApiError } from "@/api";
import { useSession } from "@/session";
import { radius } from "@/theme";
import { PrimaryButton, useColors } from "@/ui";

export default function LoginScreen() {
  const colors = useColors();
  const { token, loading, signIn } = useSession();
  const [vehicleCode, setVehicleCode] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.ground, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  if (token) {
    return <Redirect href="/(tabs)" />;
  }

  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const result = await api.login(vehicleCode.trim(), pin.trim());
      await signIn(result.token, result.vehicle);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle = {
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    fontWeight: "700" as const,
    color: colors.ink,
  };
  const labelStyle = {
    color: colors.inkFaint,
    fontSize: 12,
    fontWeight: "700" as const,
    letterSpacing: 1.2,
    textTransform: "uppercase" as const,
    marginBottom: 7,
    marginLeft: 4,
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.ground }}>
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: "center", padding: 22 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={{ alignItems: "center", marginBottom: 32 }}>
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 20,
              backgroundColor: colors.brand,
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 16,
            }}
          >
            <Text style={{ fontSize: 30 }}>🥛</Text>
          </View>
          <Text style={{ color: colors.ink, fontSize: 22, fontWeight: "800", letterSpacing: -0.4 }}>Driver sign-in</Text>
          <Text style={{ color: colors.inkSoft, fontSize: 14, marginTop: 4 }}>Enter your vehicle code &amp; PIN</Text>
        </View>

        <Text style={labelStyle}>Vehicle code</Text>
        <TextInput
          value={vehicleCode}
          onChangeText={setVehicleCode}
          placeholder="VH-04"
          placeholderTextColor={colors.inkFaint}
          autoCapitalize="characters"
          autoCorrect={false}
          style={[inputStyle, { marginBottom: 16 }]}
        />

        <Text style={labelStyle}>PIN</Text>
        <TextInput
          value={pin}
          onChangeText={setPin}
          placeholder="••••"
          placeholderTextColor={colors.inkFaint}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={6}
          style={[inputStyle, { marginBottom: 18, letterSpacing: 6 }]}
        />

        {error ? (
          <Text style={{ color: colors.danger, fontSize: 13.5, fontWeight: "600", marginBottom: 14, marginLeft: 4 }}>{error}</Text>
        ) : null}

        <PrimaryButton label="Log in" onPress={onSubmit} loading={submitting} disabled={!vehicleCode.trim() || pin.trim().length < 4} />

        {/* Dev diagnostic — shows exactly which server this build is calling, so a
            stuck/failed login is never a mystery. Remove once the API URL is stable. */}
        <Text style={{ color: colors.inkFaint, fontSize: 11, textAlign: "center", marginTop: 18 }}>
          Server: {API_BASE}
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
