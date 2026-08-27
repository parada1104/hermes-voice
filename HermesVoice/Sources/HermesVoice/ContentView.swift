import SwiftUI

struct ContentView: View {
    @EnvironmentObject var demonio: DaemonSupervisor
    @EnvironmentObject var estado: VoiceState
    @EnvironmentObject var micro: MicMeter
    @EnvironmentObject var config: ConfigStore

    @EnvironmentObject var miniOrb: MiniOrbController
    @EnvironmentObject var feed: ActivityFeed
    @State private var mostrarAjustes = false
    @State private var feedExtendido = false
    @State private var muteado = false
    @State private var pulso = false

    private let fondo = Color(red: 0.082, green: 0.090, blue: 0.110)

    var body: some View {
        VStack(spacing: 18) {
            encabezado
            orbe
            etiquetas
            medidor
            controles
            actividad
            if mostrarAjustes { Divider().overlay(Color.white.opacity(0.08)); ajustes }
        }
        .padding(22)
        .frame(minWidth: 380)
        .background(fondo)
        .onAppear { pulso = true }
    }

    // MARK: - Partes

    private var encabezado: some View {
        HStack {
            Circle()
                .fill(colorDemonio)
                .frame(width: 7, height: 7)
            Text(textoDemonio)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.white.opacity(0.45))
            Spacer()
            Button { miniOrb.alternar(estado: estado, micro: micro, demonio: demonio) } label: {
                Image(systemName: "circle.circle")
                    .foregroundStyle(.white.opacity(0.5))
            }
            .buttonStyle(.plain)
            .help("orbe flotante sin ventana")
            Button { mostrarAjustes.toggle() } label: {
                Image(systemName: "slider.horizontal.3")
                    .foregroundStyle(.white.opacity(0.5))
            }
            .buttonStyle(.plain)
        }
    }

    /// El orbe respira solo cuando hay trabajo en curso. Es la señal que el
    /// bucle de voz no da por sí solo: transcribir, pensar y sintetizar se ven
    /// todos igual desde afuera, o sea silencio.
    private var orbe: some View {
        ZStack {
            ForEach(0..<3) { i in
                Circle()
                    .stroke(estado.fase.color.opacity(0.30 - Double(i) * 0.08), lineWidth: 1.5)
                    .frame(width: 92 + CGFloat(i) * 26, height: 92 + CGFloat(i) * 26)
                    .scaleEffect(estado.fase.pulsa && pulso ? 1.06 : 1.0)
                    .animation(
                        estado.fase.pulsa
                            ? .easeInOut(duration: 1.5 + Double(i) * 0.25).repeatForever(autoreverses: true)
                            : .default,
                        value: pulso
                    )
            }
            Circle()
                .fill(
                    RadialGradient(
                        colors: [estado.fase.color.opacity(0.85), estado.fase.color.opacity(0.12)],
                        center: .center, startRadius: 4, endRadius: 52
                    )
                )
                .frame(width: 88, height: 88)
                // Mientras escucha, el orbe crece con tu voz: el nivel del
                // micrófono se vuelve parte de la imagen, no un número aparte.
                .scaleEffect(1.0 + min(CGFloat(micro.rms) / 6000.0, 0.35))
                .animation(.easeOut(duration: 0.09), value: micro.rms)
            Text(estado.fase == .escuchando ? "◉" : "⌁")
                .font(.system(size: 26))
                .foregroundStyle(.white.opacity(0.9))
        }
        .frame(height: 150)
    }

    private var etiquetas: some View {
        VStack(spacing: 5) {
            Text(estado.fase.rawValue)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(.white.opacity(0.92))
            if !estado.sesion.isEmpty {
                Text("sesión \(String(estado.sesion.suffix(6))) · turno \(estado.turno)")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.35))
            }
            if let d = estado.detalle {
                Text(d)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(estado.fase.color.opacity(0.9))
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
            }
        }
    }

    /// Barra de micrófono con las referencias REALES de este equipo marcadas.
    /// Sin ellas el número no dice nada; con ellas se ve de un vistazo si la
    /// voz está pasando el umbral o si es ruido de sala.
    private var medidor: some View {
        VStack(spacing: 5) {
            HStack(spacing: 7) {
                Image(systemName: micro.activo ? "mic.fill" : "mic.slash.fill")
                    .font(.system(size: 11))
                    .foregroundStyle(micro.saturado ? .red : .white.opacity(0.55))
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.white.opacity(0.07))
                        Capsule()
                            .fill(micro.saturado ? Color.red : estado.fase.color)
                            .frame(width: geo.size.width * min(CGFloat(micro.rms) / 8000.0, 1.0))
                        // Umbral de silencio configurado: por debajo, Hermes
                        // considera que no hablaste.
                        Rectangle()
                            .fill(Color.white.opacity(0.5))
                            .frame(width: 1)
                            .offset(x: geo.size.width * min(CGFloat(config.umbralSilencio) / 8000.0, 1.0))
                    }
                }
                .frame(height: 7)
                Text("\(micro.rms)")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.45))
                    .frame(width: 38, alignment: .trailing)
            }
            if micro.saturado {
                Text("micrófono saturado — alejate o bajá la ganancia")
                    .font(.system(size: 9))
                    .foregroundStyle(.red.opacity(0.85))
            }
            if let e = micro.error {
                Text(e).font(.system(size: 9)).foregroundStyle(.orange.opacity(0.85))
            }
        }
    }

    private var controles: some View {
        VStack(spacing: 9) {
            HStack(spacing: 9) {
                BotonMantener(titulo: "hablar", color: Color(red: 0.49, green: 0.88, blue: 0.54)) { apretado in
                    // Sin adivinar paridad: la app sabe si está grabando
                    // porque lee la salida del proceso que ella misma lanzó.
                    if apretado != estado.grabando { demonio.alternarGrabacion() }
                }
                Boton(titulo: "nova", color: Color(red: 0.96, green: 0.77, blue: 0.26)) {
                    estado.nuevaSesion()
                    demonio.comando("/new now")
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) {
                        demonio.alternarGrabacion()
                    }
                }
            }
            HStack(spacing: 9) {
                Boton(titulo: muteado ? "🔇 mute" : "🎤 escucha",
                      color: muteado ? Color.red.opacity(0.7) : Color.white.opacity(0.5)) {
                    muteado.toggle()
                    if muteado {
                        if estado.grabando { demonio.alternarGrabacion() }
                        demonio.comando("/wake off")
                    } else {
                        demonio.comando("/wake on")
                    }
                }
                // MEDIR toma el micrófono, así que primero suelta el del
                // demonio. Sin esto el wake word queda clavado en "opening
                // microphone": dos procesos no pueden sostener el device.
                Boton(titulo: micro.activo ? "■ medir" : "▮ medir",
                      color: micro.activo ? Color(red: 0.29, green: 0.62, blue: 0.88) : Color.white.opacity(0.4)) {
                    if micro.activo {
                        micro.detener()
                        demonio.comando("/wake on")
                    } else {
                        demonio.comando("/wake off")
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { micro.arrancar() }
                    }
                }
                Boton(titulo: "reiniciar", color: Color.white.opacity(0.4)) {
                    micro.detener()
                    demonio.reiniciar()
                }
            }
        }
    }

    /// Qué está haciendo, en palabras. El orbe da la FASE; esto da los pasos.
    /// Colapsado muestra solo lo último — que es lo que importa mientras
    /// esperás. Extendido muestra el turno entero, para entender por qué tardó.
    private var actividad: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(feedExtendido ? "actividad" : (feed.ultimo?.titulo ?? "sin actividad"))
                    .font(.system(size: 11))
                    .foregroundStyle(.white.opacity(feed.ultimo == nil ? 0.3 : 0.75))
                    .lineLimit(1)
                if !feedExtendido, let d = feed.ultimo?.detalle {
                    Text(d).font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(.white.opacity(0.4))
                }
                Spacer()
                Image(systemName: feedExtendido ? "chevron.up" : "chevron.down")
                    .font(.system(size: 9))
                    .foregroundStyle(.white.opacity(0.4))
            }
            .contentShape(Rectangle())
            .onTapGesture { withAnimation(.easeInOut(duration: 0.18)) { feedExtendido.toggle() } }

            if feedExtendido {
                ScrollViewReader { lector in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 3) {
                            ForEach(feed.eventos) { e in
                                HStack(alignment: .top, spacing: 6) {
                                    Text(e.icono).font(.system(size: 10)).frame(width: 15)
                                    Text(e.hora).font(.system(size: 9, design: .monospaced))
                                        .foregroundStyle(.white.opacity(0.28))
                                    Text(e.titulo).font(.system(size: 10)).foregroundStyle(e.color)
                                    Spacer(minLength: 4)
                                    if let d = e.detalle {
                                        Text(d).font(.system(size: 9, design: .monospaced))
                                            .foregroundStyle(.white.opacity(0.38))
                                            .lineLimit(1)
                                    }
                                }
                                .id(e.id)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(height: 132)
                    // Seguir lo último sin tener que arrastrar.
                    .onChange(of: feed.eventos.count) { _, _ in
                        if let u = feed.ultimo { withAnimation { lector.scrollTo(u.id, anchor: .bottom) } }
                    }
                }
            }
        }
        .padding(9)
        .background(Color.white.opacity(0.035))
        .clipShape(RoundedRectangle(cornerRadius: 7))
    }

    private var ajustes: some View {
        VStack(alignment: .leading, spacing: 11) {
            Toggle(isOn: $config.bargeIn) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("barge-in (interrumpir hablando)").font(.system(size: 12))
                    Text("medido acá: el altavoz sangra a 2610 y tu voz a 588. Solo con auriculares.")
                        .font(.system(size: 9)).foregroundStyle(.white.opacity(0.4))
                }
            }
            Toggle(isOn: $micro.cancelacionEco) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("cancelación de eco del micrófono").font(.system(size: 12))
                    Text("unidad de voz de macOS: resta el altavoz y normaliza ganancia.")
                        .font(.system(size: 9)).foregroundStyle(.white.opacity(0.4))
                }
            }
            Toggle("modo continuo tras la palabra de activación", isOn: $config.continuoTrasWake)
                .font(.system(size: 12))

            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text("umbral de silencio").font(.system(size: 12))
                    Spacer()
                    Text("\(config.umbralSilencio)").font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(.white.opacity(0.5))
                }
                Slider(value: Binding(
                    get: { Double(config.umbralSilencio) },
                    set: { config.umbralSilencio = Int($0) }
                ), in: 100...1500, step: 25)
                Text("piso de sala medido: p90 162, pico 338. Por debajo del pico, el ruido se cuela como voz.")
                    .font(.system(size: 9)).foregroundStyle(.white.opacity(0.4))
            }

            Button("guardar y reiniciar el servicio") {
                if config.guardar() { demonio.reiniciar() }
            }
            .font(.system(size: 12))
            if let e = config.error {
                Text(e).font(.system(size: 9)).foregroundStyle(.red.opacity(0.85))
            }
        }
        .tint(estado.fase.color)
        .foregroundStyle(.white.opacity(0.85))
    }

    // MARK: - Auxiliares

    private var colorDemonio: Color {
        switch demonio.status {
        case .corriendo: return .green
        case .arrancando: return .yellow
        case .detenido: return .gray
        case .caido: return .red
        }
    }

    private var textoDemonio: String {
        switch demonio.status {
        case .corriendo:      return "servicio activo"
        case .arrancando:     return "arrancando…"
        case .detenido:       return "detenido"
        case .caido(let m):   return "caído · \(m)"
        }
    }
}

// MARK: - Botones

struct Boton: View {
    let titulo: String
    let color: Color
    let accion: () -> Void
    var body: some View {
        Text(titulo)
            .font(.system(size: 12))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 7)
            .background(color.opacity(0.16))
            .foregroundStyle(color)
            .clipShape(RoundedRectangle(cornerRadius: 7))
            .contentShape(Rectangle())
            .onTapGesture(perform: accion)
    }
}

/// Push-while-talk de verdad: informa apretado/soltado, no un toggle a ciegas.
struct BotonMantener: View {
    let titulo: String
    let color: Color
    let alCambiar: (Bool) -> Void
    @State private var apretado = false

    var body: some View {
        Text(titulo)
            .font(.system(size: 12, weight: .medium))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 7)
            .background(color.opacity(apretado ? 0.85 : 0.16))
            .foregroundStyle(apretado ? Color.black : color)
            .clipShape(RoundedRectangle(cornerRadius: 7))
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in
                        if !apretado { apretado = true; alCambiar(true) }
                    }
                    .onEnded { _ in
                        apretado = false; alCambiar(false)
                    }
            )
    }
}
