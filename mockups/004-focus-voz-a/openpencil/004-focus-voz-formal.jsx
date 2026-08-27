<Frame name="Hermes Voice / 004-focus-voz / formal-spec" w={1440} h={900} bg="#0B0C0E" rounded={0} p={0}>

  <!-- ============================================================ -->
  <!--  VISTA PRINCIPAL — split panel (production, dark, formal)     -->
  <!-- ============================================================ -->
  <Frame name="app/root" x={0} y={0} w={1440} h={900} bg="#0B0C0E" p={0}>

    <!-- ---------- HEADER ---------- -->
    <Frame name="header" x={0} y={0} w={1440} h={58} bg="#0E0F12" p={0} shadow="0 1 0 rgba(255,255,255,0.07)">
      <Frame name="header/logo" x={18} y={14} w={200} h={30} p={0}>
        <Rectangle name="header/logo-mark" x={0} y={0} w={30} h={30} fill="#D97A3F" rounded={9} />
        <Rectangle name="header/logo-mark/hi" x={0} y={0} w={30} h={30} fill="#F0905C" opacity={0} rounded={9} />
        <Text name="header/logo-name" x={42} y={1} size={15} weight={600} color="#F4F5F6">Hermes Voice</Text>
        <Text name="header/logo-sub" x={42} y={20} size={10} weight={400} color="#646A72">codex-lite</Text>
      </Frame>

      <Frame name="header/mode-seg" x={1010} y={13} w={260} h={32} bg="#14161A" rounded={10} p={3}>
        <Frame name="header/mode-seg/voz" x={3} y={3} w={84} h={26} bg="#20232A" rounded={8} p={0}>
          <Text name="header/mode-seg/voz-label" x={24} y={6} size={12} weight={500} color="#F4F5F6">Voz</Text>
        </Frame>
        <Frame name="header/mode-seg/chat" x={89} y={3} w={84} h={26} bg="#E9EAEB" color="#14161A" opacity={0} rounded={8} p={0}>
          <Text name="header/mode-seg/chat-label" x={24} y={6} size={12} weight={500} color="#646A72">Chat</Text>
        </Frame>
        <Frame name="header/mode-seg/agentes" x={175} y={3} w={82} h={26} bg="#E9EAEB" opacity={0} rounded={8} p={0}>
          <Text name="header/mode-seg/agentes-label" x={18} y={6} size={12} weight={500} color="#646A72">Agentes</Text>
        </Frame>
      </Frame>

      <Frame name="header/agent-btn" x={1284} y={14} w={88} h={30} bg="#14161A" rounded={10} p={0}>
        <Ellipse name="header/agent-dot" x={11} y={12} w={6} h={6} fill="#2FBF8F" />
        <Text name="header/agent-name" x={24} y={7} size={13} weight={500} color="#9AA0AA">Orca</Text>
      </Frame>

      <Frame name="header/status-pill" x={1386} y={15} w={48} h={28} bg="#14161A" rounded={999} p={0}>
        <Ellipse name="header/status-dot" x={12} y={11} w={6} h={6} fill="#F0905C" />
        <Text name="header/status-text" x={24} y={7} size={11} weight={500} color="#646A72">On</Text>
      </Frame>
    </Frame>

    <!-- ---------- VOICE PANE (384px) ---------- -->
    <Frame name="vpane" x={0} y={58} w={384} h={842} bg="#14161A" p={0} shadow="0 1 0 rgba(255,255,255,0.07)">
      <!-- header -->
      <Text name="vpane/title" x={18} y={76} size={10} weight={600} color="#4A5057">VOZ EN VIVO · ESCUCHANDO</Text>
      <Frame name="vpane/orb" x={330} y={70} w={38} h={38} bg="#D97A3F" rounded={999} p={0} shadow="0 0 0 6 rgba(217,122,63,0.07), 0 8 22 -8 rgba(217,122,63,0.55)">
        <Ellipse name="vpane/orb/capsule" x={14} y={8} w={10} h={14} stroke="#FFFFFF" strokeWidth={1.5} />
        <Ellipse name="vpane/orb/arc" x={9} y={11} w={20} h={12} stroke="#FFFFFF" strokeWidth={1.5} opacity={0.9} />
        <Rectangle name="vpane/orb/base" x={17} y={22} w={4} h={5} stroke="#FFFFFF" strokeWidth={1.5} />
      </Frame>

      <!-- live transcript -->
      <Frame name="vpane/live" x={0} y={124} w={384} h={440} p={0}>
        <Text name="vpane/live/line1" x={18} y={0} size={13} weight={500} color="#F4F5F6">Robert:</Text>
        <Text name="vpane/live/line1-cur" x={72} y={0} size={13} weight={400} color="#F0905C">Etiqueta de café pa</Text>
        <Text name="vpane/live/caret" x={194} y={0} size={13} weight={400} color="#F0905C">▍</Text>
        <Text name="vpane/live/time" x={18} y={26} size={10} weight={400} color="#4A5057">transcripción en vivo · 0:14</Text>

        <Frame name="vpane/transcript" x={0} y={58} w={384} h={200} p={0}>
          <Frame name="vpane/transcript/user" x={18} y={0} w={348} h={74} p={0}>
            <Rectangle name="vpane/transcript/user/avatar" x={0} y={0} w={24} h={24} fill="#3A3F4B" rounded={7} />
            <Text name="vpane/transcript/user/avatar-leaf" x={8} y={5} size={11} weight={600} color="#FFFFFF">R</Text>
            <Text name="vpane/transcript/user/who" x={34} y={0} size={10} weight={500} color="#646A72">Robert · 14:02</Text>
            <Text name="vpane/transcript/user/body" x={34} y={18} size={12} weight={400} color="#9AA0AA">Etiqueta de café para Aurora — "Reserva del Valle". Tono minimal, papel kraft, tipografía limpia.</Text>
          </Frame>
          <Frame name="vpane/transcript/hermes-a" x={18} y={86} w={348} h={54} p={0}>
            <Rectangle name="vpane/transcript/hermes-a/avatar" x={0} y={0} w={24} h={24} fill="#D97A3F" rounded={7} />
            <Text name="vpane/transcript/hermes-a/who" x={34} y={0} size={10} weight={500} color="#646A72">Hermes Voice · hace 2 min</Text>
            <Text name="vpane/transcript/hermes-a/body" x={34} y={18} size={12} weight={400} color="#9AA0AA">Perfecto. Delego a Orca: brief kraft minimal para Reserva del Valle. Ya está generando.</Text>
          </Frame>
          <Frame name="vpane/transcript/hermes-b" x={18} y={150} w={348} h={50} p={0}>
            <Rectangle name="vpane/transcript/hermes-b/avatar" x={0} y={0} w={24} h={24} fill="#D97A3F" rounded={7} />
            <Text name="vpane/transcript/hermes-b/who" x={34} y={0} size={10} weight={500} color="#646A72">Hermes Voice · ahora</Text>
            <Text name="vpane/transcript/hermes-b/body" x={34} y={18} size={12} weight={400} color="#9AA0AA">Ya casi está: el agente va al 64%.</Text>
          </Frame>
        </Frame>
      </Frame>

      <!-- ---------- PHASE STEPPER ---------- -->
      <Frame name="vpane/steps" x={0} y={580} w={384} h={220} p={0}>
        <Frame name="vpane/step/01-listening" x={16} y={0} w={352} h={56} bg="#1B1E24" rounded={10} p={0} shadow="0 1 2 rgba(0,0,0,0.3)">
          <Ellipse name="vpane/step/01-listening/num" x={12} y={14} w={22} h={22} fill="#D97A3F" />
          <Text name="vpane/step/01-listening/num-label" x={18} y={17} size={10} weight={600} color="#FFFFFF">01</Text>
          <Text name="vpane/step/01-listening/label" x={46} y={20} size={12} weight={500} color="#F4F5F6">Escuchando</Text>
          <Frame name="vpane/step/01-listening/bars" x={296} y={22} w={50} h={12} p={0}>
            <Rectangle name="vpane/step/01-listening/b1" x={0} y={7} w={3} h={5} fill="#F0905C" rounded={2} />
            <Rectangle name="vpane/step/01-listening/b2" x={6} y={0} w={3} h={12} fill="#F0905C" rounded={2} />
            <Rectangle name="vpane/step/01-listening/b3" x={12} y={3} w={3} h={9} fill="#F0905C" rounded={2} />
            <Rectangle name="vpane/step/01-listening/b4" x={18} y={0} w={3} h={12} fill="#F0905C" rounded={2} />
          </Frame>
        </Frame>
        <Frame name="vpane/step/02-transcribing" x={16} y={64} w={352} h={56} bg="#0B0C0E" rounded={10} p={0} stroke="#5A5F66" strokeWidth={1}>
          <Ellipse name="vpane/step/02-transcribing/num" x={12} y={14} w={22} h={22} fill="#1B1E24" />
          <Text name="vpane/step/02-transcribing/num-label" x={18} y={17} size={10} weight={600} color="#646A72">02</Text>
          <Text name="vpane/step/02-transcribing/label" x={46} y={20} size={12} weight={500} color="#646A72">Transcribiendo</Text>
        </Frame>
        <Frame name="vpane/step/03-speaking" x={16} y={128} w={352} h={56} bg="#0B0C0E" rounded={10} p={0} stroke="#5A5F66" strokeWidth={1}>
          <Ellipse name="vpane/step/03-speaking/num" x={12} y={14} w={22} h={22} fill="#1B1E24" />
          <Text name="vpane/step/03-speaking/num-label" x={18} y={17} size={10} weight={600} color="#646A72">03</Text>
          <Text name="vpane/step/03-speaking/label" x={46} y={20} size={12} weight={500} color="#646A72">Hablando</Text>
        </Frame>
      </Frame>
    </Frame>

    <!-- ---------- CHAT PANE ---------- -->
    <Frame name="cpane" x={384} y={58} w={1056} h={842} bg="#0B0C0E" p={0}>

      <Frame name="cpane/day-div" x={0} y={22} w={1056} h={20} p={0}>
        <Rectangle name="cpane/day-div/line-a" x={190} y={9} w={240} h={1} fill="#16181C" />
        <Text name="cpane/day-div/label" x={444} y={2} size={11} weight={500} color="#4A5057">Hoy</Text>
        <Rectangle name="cpane/day-div/line-b" x={484} y={9} w={240} h={1} fill="#16181C" />
      </Frame>

      <Frame name="cpane/msg-user" x={450} y={64} w={480} h={74} p={0}>
        <Frame name="cpane/msg-user/meta" x={0} y={0} w={480} h={18} p={0}>
          <Text name="cpane/msg-user/name" x={404} y={0} size={11} weight={500} color="#646A72">Robert</Text>
          <Text name="cpane/msg-user/time" x={446} y={0} size={10} weight={400} color="#4A5057">14:02</Text>
        </Frame>
        <Frame name="cpane/msg-user/bubble" x={94} y={24} w={386} h={50} bg="#1B1E24" rounded={15} p={0} shadow="0 1 2 rgba(0,0,0,0.3)">
          <Text name="cpane/msg-user/bubble/text" x={16} y={12} size={13} weight={400} color="#F4F5F6">Etiqueta de café para Aurora — "Reserva del Valle". Tono minimal, kraft, tipografía limpia.</Text>
        </Frame>
      </Frame>

      <!-- ---------- DELEGATION CARD ---------- -->
      <Frame name="cpane/deleg" x={236} y={158} w={598} h={180} bg="#14161A" rounded={14} p={0} shadow="0 1 2 rgba(0,0,0,0.3)">
        <Frame name="cpane/deleg/head" x={0} y={0} w={598} h={44} p={0}>
          <Text name="cpane/deleg/head/ico" x={14} y={16} size={14} weight={400} color="#A58AF0">◈</Text>
          <Text name="cpane/deleg/head/title" x={36} y={13} size={13} weight={500} color="#F4F5F6">Etiqueta Reserva del Valle</Text>
          <Frame name="cpane/deleg/head/agent" x={186} y={12} w={70} h={20} bg="#A58AF01A" rounded={6} p={0}>
            <Text name="cpane/deleg/head/agent-label" x={8} y={4} size={10} weight={500} color="#A58AF0">orca-7b</Text>
          </Frame>
          <Frame name="cpane/deleg/head/status" x={470} y={15} w={92} h={16} p={0}>
            <Ellipse name="cpane/deleg/head/status-dot" x={0} y={5} w={6} h={6} fill="#EAB04C" />
            <Text name="cpane/deleg/head/status-text" x={12} y={1} size={11} weight={500} color="#EAB04C">Ejecutando</Text>
          </Frame>
        </Frame>
        <Rectangle name="cpane/deleg/divider" x={0} y={44} w={598} h={1} fill="#16181C" />
        <Frame name="cpane/deleg/body" x={0} y={45} w={598} h={135} p={0}>
          <Text name="cpane/deleg/body/brief-key" x={16} y={18} size={11} weight={500} color="#4A5057">brief</Text>
          <Text name="cpane/deleg/body/brief-val" x={110} y={18} size={12} weight={400} color="#9AA0AA">Etiqueta café kraft minimal "RESERVA DEL VALLE", tipografía limpia, estética Aurora.</Text>
          <Text name="cpane/deleg/body/flujo-key" x={16} y={44} size={11} weight={500} color="#4A5057">flujo</Text>
          <Text name="cpane/deleg/body/flujo-val" x={110} y={44} size={12} weight={400} color="#9AA0AA">flux2 → compositing → etiqueta</Text>
          <Frame name="cpane/deleg/body/term" x={16} y={72} w={566} h={48} bg="#0B0C0E" rounded={8} p={0}>
            <Text name="cpane/deleg/body/term-$" x={12} y={6} size={12} weight={400} color="#2FBF8F">$</Text>
            <Text name="cpane/deleg/body/term-cmd" x={28} y={6} size={12} weight={400} color="#6AA6E8">comfyui</Text>
            <Text name="cpane/deleg/body/term-arg" x={92} y={6} size={12} weight={400} color="#9AA0AA">.queue --workflow etiqueta_kraft_v2.json</Text>
            <Text name="cpane/deleg/body/term-o1" x={12} y={24} size={12} weight={400} color="#9AA0AA">→ queued #182</Text>
            <Text name="cpane/deleg/body/term-o2" x={12} y={42} size={12} weight={400} color="#9AA0AA">→ sampling 64% · 18s</Text>
          </Frame>
        </Frame>
      </Frame>

      <Frame name="cpane/msg-orca" x={432} y={356} w={520} h={92} p={0}>
        <Frame name="cpane/msg-orca/meta" x={0} y={0} w={520} h={18} p={0}>
          <Rectangle name="cpane/msg-orca/avatar" x={0} y={0} w={20} h={20} fill="#23262E" rounded={6} />
          <Text name="cpane/msg-orca/name" x={28} y={3} size={11} weight={500} color="#9AA0AA">Orca</Text>
          <Text name="cpane/msg-orca/time" x={62} y={3} size={10} weight={400} color="#4A5057">hace 30 s</Text>
        </Frame>
        <Frame name="cpane/msg-orca/bubble" x={0} y={24} w={420} h={58} bg="#20232A" rounded={15} p={0}>
          <Text name="cpane/msg-orca/bubble/text" x={16} y={12} size={13} weight={400} color="#F4F5F6">Render listo: etiqueta_reserva_v2.png · 1024×1024.</Text>
          <Text name="cpane/msg-orca/bubble/mono" x={-20} y={12} size={11} weight={400} color="#646A72">#182</Text>
        </Frame>
      </Frame>

      <Frame name="cpane/msg-user2" x={450} y={464} w={480} h={54} p={0}>
        <Text name="cpane/msg-user2/name" x={404} y={0} size={11} weight={500} color="#646A72">Robert</Text>
        <Text name="cpane/msg-user2/time" x={446} y={0} size={10} weight={400} color="#4A5057">14:05</Text>
        <Frame name="cpane/msg-user2/bubble" x={190} y={24} w={290} h={30} bg="#1B1E24" rounded={15} p={0}>
          <Text name="cpane/msg-user2/bubble/text" x={16} y={8} size={13} weight={400} color="#F4F5F6">Súbelo a la entrega y avísame.</Text>
        </Frame>
      </Frame>

      <!-- ---------- COMPOSER ---------- -->
      <Frame name="cpane/composer" x={238} y={792} w={740} h={62} bg="#14161ACC" rounded={18} p={0} shadow="0 28 64 -20 rgba(0,0,0,0.85)">
        <Text name="cpane/composer/placeholder" x={16} y={20} size={13} weight={400} color="#4A5057">Escribe a Hermes, o usa el mic…</Text>
        <Frame name="cpane/composer/actions" x={670} y={15} w={96} h={32} p={0}>
          <Frame name="cpane/composer/attach" x={0} y={0} w={32} h={32} bg="#0B0C0E" rounded={9} p={0} stroke="#16181C" strokeWidth={1}>
            <Text name="cpane/composer/attach/ico" x={8} y={6} size={14} weight={400} color="#646A72">⧉</Text>
          </Frame>
          <Frame name="cpane/composer/quick" x={40} y={0} w={32} h={32} bg="#0B0C0E" rounded={9} p={0} stroke="#16181C" strokeWidth={1}>
            <Text name="cpane/composer/quick/ico" x={8} y={6} size={14} weight={400} color="#646A72">⚡</Text>
          </Frame>
          <!-- ---- MIC BUTTON (line icon, stroke 1.5) ---- -->
          <Frame name="cpane/composer/mic" x={80} y={-4} w={40} h={40} bg="#D97A3F" rounded={999} p={0} shadow="0 10 26 -8 rgba(217,122,63,0.75)">
            <Ellipse name="cpane/composer/mic/capsule" x={14} y={7} w={12} h={17} stroke="#FFFFFF" strokeWidth={1.5} />
            <Ellipse name="cpane/composer/mic/arc" x={9} y={10} w={22} h={13} stroke="#FFFFFF" strokeWidth={1.5} opacity={0.92} />
            <Rectangle name="cpane/composer/mic/base" x={18} y={26} w={4} h={5} stroke="#FFFFFF" strokeWidth={1.5} />
          </Frame>
        </Frame>
      </Frame>
    </Frame>
  </Frame>

  <!-- ============================================================ -->
  <!--  SET DE ICONOS — line, stroke 1.5, geométrico (production)     -->
  <!-- ============================================================ -->
  <Frame name="icons/mic-set" x={1560} y={0} w={420} h={260} bg="#14161A" rounded={14} p={0}>
    <Text name="icons/mic-set/title" x={24} y={22} size={14} weight={700} color="#F4F5F6">Iconos de micrófono — line 1.5</Text>
    <Text name="icons/mic-set/sub" x={24} y={46} size={11} weight={400} color="#646A72">stroke-width 1.5 · currentColor · fill none · geometric</Text>
    <Frame name="icons/mic-set/idle" x={24} y={80} w={110} h={120} bg="#0B0C0E" rounded={12} p={0}>
      <Ellipse name="icons/mic-set/idle/capsule" x={48} y={24} w={14} h={22} stroke="#9AA0AA" strokeWidth={1.5} />
      <Ellipse name="icons/mic-set/idle/arc" x={40} y={28} w={30} h={18} stroke="#9AA0AA" strokeWidth={1.5} />
      <Rectangle name="icons/mic-set/idle/base" x={52} y={54} w={6} h={7} stroke="#9AA0AA" strokeWidth={1.5} />
      <Text name="icons/mic-set/idle/label" x={30} y={86} size={10} weight={500} color="#646A72">idle</Text>
    </Frame>
    <Frame name="icons/mic-set/listening" x={146} y={80} w={110} h={120} bg="#0B0C0E" rounded={12} p={0}>
      <Ellipse name="icons/mic-set/listening/capsule" x={48} y={24} w={14} h={22} stroke="#F0905C" strokeWidth={1.5} />
      <Ellipse name="icons/mic-set/listening/arc" x={40} y={28} w={30} h={18} stroke="#F0905C" strokeWidth={1.5} />
      <Rectangle name="icons/mic-set/listening/base" x={52} y={54} w={6} h={7} stroke="#F0905C" strokeWidth={1.5} />
      <Ellipse name="icons/mic-set/listening/glow" x={24} y={6} w={60} h={60} fill="#F0905C" opacity={0.1} />
      <Text name="icons/mic-set/listening/label" x={14} y={86} size={10} weight={500} color="#F0905C">listening</Text>
    </Frame>
    <Frame name="icons/mic-set/mute" x={268} y={80} w={110} h={120} bg="#0B0C0E" rounded={12} p={0}>
      <Ellipse name="icons/mic-set/mute/capsule" x={48} y={24} w={14} h={22} stroke="#4A5057" strokeWidth={1.5} opacity={0.55} />
      <Ellipse name="icons/mic-set/mute/slash" x={40} y={26} w={30} h={26} stroke="#4A5057" strokeWidth={1.5} />
      <Rectangle name="icons/mic-set/mute/base" x={52} y={54} w={6} h={7} stroke="#4A5057" strokeWidth={1.5} opacity={0.55} />
      <Text name="icons/mic-set/mute/label" x={12} y={86} size={10} weight={500} color="#4A5057">mute</Text>
    </Frame>
  </Frame>

  <!-- ============================================================ -->
  <!--  ESTADOS DE VOZ — orb (idle / listening / speaking)           -->
  <!-- ============================================================ -->
  <Frame name="voice-states" x={1560} y={280} w={420} h={300} bg="#14161A" rounded={14} p={0}>
    <Text name="voice-states/title" x={24} y={22} size={14} weight={700} color="#F4F5F6">Estados de voz — orb</Text>
    <Frame name="voice-states/idle" x={30} y={70} w={110} h={150} p={0}>
      <Ellipse name="voice-states/idle/orb" x={30} y={30} w={50} h={50} fill="#D97A3F" />
      <Text name="voice-states/idle/label" x={34} y={116} size={10} weight={500} color="#646A72">idle</Text>
    </Frame>
    <Frame name="voice-states/listening" x={155} y={70} w={110} h={150} p={0}>
      <Ellipse name="voice-states/listening/halo-a" x={14} y={14} w={82} h={82} fill="#6AA6E8" opacity={0.1} />
      <Ellipse name="voice-states/listening/orb" x={30} y={30} w={50} h={50} fill="#D97A3F" />
      <Text name="voice-states/listening/label" x={18} y={116} size={10} weight={500} color="#6AA6E8">listening</Text>
    </Frame>
    <Frame name="voice-states/speaking" x={280} y={70} w={110} h={150} p={0}>
      <Ellipse name="voice-states/speaking/halo-a" x={10} y={10} w={90} h={90} fill="#F0905C" opacity={0.14} />
      <Ellipse name="voice-states/speaking/orb" x={30} y={30} w={50} h={50} fill="#F0905C" />
      <Text name="voice-states/speaking/label" x={12} y={116} size={10} weight={500} color="#F0905C">speaking</Text>
    </Frame>
  </Frame>

</Frame>
