import AppKit
import SwiftUI

/// Orbe flotante sin ventana.
///
/// Un `NSPanel` sin borde, siempre encima y con fondo transparente: nada de
/// barra de título, semáforo ni sombra de ventana. Es lo que hacía el HUD de
/// tkinter con `overrideredirect(True)` + `-topmost`, que resultó ser la forma
/// correcta de mirar el estado sin que la ventana estorbe.
///
/// `.nonactivatingPanel` es clave: al arrastrarlo o tocarlo NO le roba el foco
/// a lo que estés haciendo.
@MainActor
final class MiniOrbController: ObservableObject {
    private var panel: NSPanel?

    func alternar(estado: VoiceState, micro: MicMeter, demonio: DaemonSupervisor) {
        if panel != nil { cerrar(); return }

        let vista = MiniOrbView()
            .environmentObject(estado)
            .environmentObject(micro)
            .environmentObject(demonio)

        let p = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 132, height: 132),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        p.isOpaque = false
        p.backgroundColor = .clear
        p.hasShadow = false
        p.level = .floating
        p.isMovableByWindowBackground = true      // se arrastra desde cualquier punto
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        p.contentView = NSHostingView(rootView: vista)

        // Abajo a la derecha, como el HUD anterior.
        if let pantalla = NSScreen.main {
            let v = pantalla.visibleFrame
            p.setFrameOrigin(NSPoint(x: v.maxX - 160, y: v.minY + 90))
        }
        p.orderFrontRegardless()
        panel = p
    }

    func cerrar() {
        panel?.orderOut(nil)
        panel = nil
    }
}

/// Solo la esfera y el micrófono. Sin texto salvo que haya algo roto.
struct MiniOrbView: View {
    @EnvironmentObject var estado: VoiceState
    @EnvironmentObject var micro: MicMeter
    @EnvironmentObject var demonio: DaemonSupervisor
    @State private var pulso = false

    var body: some View {
        ZStack {
            ForEach(0..<2) { i in
                Circle()
                    .stroke(estado.fase.color.opacity(0.28 - Double(i) * 0.10), lineWidth: 1.5)
                    .frame(width: 74 + CGFloat(i) * 22, height: 74 + CGFloat(i) * 22)
                    .scaleEffect(estado.fase.pulsa && pulso ? 1.07 : 1.0)
                    .animation(
                        estado.fase.pulsa
                            ? .easeInOut(duration: 1.4 + Double(i) * 0.3).repeatForever(autoreverses: true)
                            : .default,
                        value: pulso
                    )
            }

            Circle()
                .fill(RadialGradient(
                    colors: [estado.fase.color.opacity(0.9), estado.fase.color.opacity(0.15)],
                    center: .center, startRadius: 3, endRadius: 42))
                .frame(width: 70, height: 70)
                // El nivel del micrófono ES el tamaño del orbe. En una vista de
                // 132 px no entra una barra, y de todos modos esto se lee más
                // rápido que un número.
                .scaleEffect(1.0 + min(CGFloat(micro.rms) / 6000.0, 0.30))
                .animation(.easeOut(duration: 0.08), value: micro.rms)

            // Anillo de nivel: se cierra a medida que el micrófono sube, y se
            // pone rojo al saturar.
            Circle()
                .trim(from: 0, to: min(CGFloat(micro.rms) / 8000.0, 1.0))
                .stroke(micro.saturado ? Color.red : Color.white.opacity(0.55),
                        style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                .frame(width: 84, height: 84)
                .rotationEffect(.degrees(-90))
                .animation(.easeOut(duration: 0.08), value: micro.rms)

            Image(systemName: micro.activo ? "mic.fill" : "mic.slash.fill")
                .font(.system(size: 19))
                .foregroundStyle(.white.opacity(0.92))
        }
        .frame(width: 132, height: 132)
        .onAppear { pulso = true }
        // Mantener = hablar, igual que el botón grande.
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in if !estado.grabando { demonio.alternarGrabacion() } }
                .onEnded   { _ in if estado.grabando  { demonio.alternarGrabacion() } }
        )
        .help("mantener para hablar · el anillo es el nivel del micrófono")
    }
}
