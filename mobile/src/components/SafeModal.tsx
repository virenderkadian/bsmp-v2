import type { ReactNode } from "react";
import { Modal } from "react-native";
import {
  initialWindowMetrics,
  SafeAreaProvider,
  SafeAreaView,
  type Edge,
} from "react-native-safe-area-context";
import { useColors } from "@/ui";

// A full-screen modal that respects the notch / Dynamic Island from the very
// first frame.
//
// On iOS an RN <Modal> is its own native window. A SafeAreaView inside it is
// not guaranteed to know the insets the first time the modal opens — it
// measures after the first layout — so on that first open the header (and the
// close button in it) sat up under the notch, where taps don't land. Every
// later open looked fine because the measurement had been cached. Giving the
// modal its own provider, seeded with the window's known insets, makes the
// first render correct.
export function SafeModal({
  visible,
  onClose,
  edges,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  edges?: Edge[];
  children: ReactNode;
}) {
  const colors = useColors();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.ground }} edges={edges}>
          {children}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
