# Ferindo Direitos Humanos com amigos — edição Mesa 3D

Jogo de cartas multiplayer para grupos de amigos. Salas privadas, catálogo de humor adulto e estado temporário em memória.

**Stack:** React + TypeScript + Vite, Three.js (WebGL 2) e HTTP/WebSockets nativos do Bun.

### Jogar a edição 3D

Com Bun instalado, execute na raiz:

```sh
bun install --frozen-lockfile
bun run build
ENABLE_BOT_TEST_MODE=true bun run start
```

Abra **http://localhost:3000**, informe o apelido e escolha **Testar com 2 bots** para jogar sozinho ou **Criar minha sala** para receber amigos. Na sala de espera, selecione **Começar a partida**. Para disponibilizar só o multiplayer, inicie sem a variável de bots.

A câmera começa no seu assento, como quem se inclina sobre a mesa. Use o botão com a câmera para alternar para a vista de cima. Para ver de perto, use os botões **+ / −** no canto da cena, **Ctrl/⌘ + rolagem** ou a pinça do trackpad ou da tela: o zoom aproxima o ponto apontado, arrastar move a vista e o botão de enquadrar volta à mesa inteira. A rolagem comum continua rolando a página. Sua mão fica em pé num suporte de cartas de madeira à sua frente; toque em uma carta para puxá-la do suporte e confirme na barra **Enviar resposta** — a carta jogada vira e desliza para a pilha do centro, e o resto da mão continua no suporte. A pergunta fica num pequeno cavalete no centro, ao lado dos baralhos preto e branco. O juiz pode selecionar uma combinação direto na mesa (ela é erguida para leitura) e confirmar em **Escolher vencedora**. As cartas viradas chegam ao centro, sem identificar o remetente; a mão local permanece privada. No resultado, a combinação vencedora é erguida em dourado e o assento vencedor fica dourado.

O cenário, os assentos, o martelo e a arte das cartas são gerados localmente em `client/src/table/`, sem modelos ou imagens remotos. O renderizador é carregado sob demanda e só desenha quadros quando necessário. Os controles de cartas abaixo da cena oferecem o mesmo jogo por teclado, em telas pequenas ou se WebGL estiver indisponível.

## Desenvolvimento

Requer Bun **1.4.3** ou versão compatível. Use a mesma versão no desenvolvimento e no Render.

1. Instale as dependências: `bun install --frozen-lockfile`.
2. Em um terminal: `bun run dev:server`.
3. Em outro terminal: `bun run dev:client`.
4. Abra `http://localhost:5173` em dois navegadores ou abas.

Um jogador cria a sala e os outros entram pelo código ou convite. Dois navegadores já conseguem usar o lobby. São necessários **três jogadores** para iniciar a partida. Cada aba mantém uma sessão independente.

### Testar sozinho com dois bots

O modo é **desabilitado por padrão**. Para habilitar, configure no backend:

```env
ENABLE_BOT_TEST_MODE=true
```

Localmente, você pode definir essa linha em um `.env` na raiz (veja `.env.example`) ou executar `ENABLE_BOT_TEST_MODE=true bun run dev:server`. No Render, adicione a variável nas configurações de ambiente do serviço. Para desabilitar, use `ENABLE_BOT_TEST_MODE=false` ou remova a variável. Apenas `true` habilita (ignorando espaços externos e maiúsculas/minúsculas); valores inválidos, `1` e `yes` continuam desabilitados.

**Reinicie o backend após alterar.** A flag é lida uma vez por inicialização. Não é necessário configurar `VITE_*` nem recompilar o frontend. Reiniciar o processo apaga as partidas existentes em memória, como já ocorre no projeto.

O servidor envia `server.config` com `features.botTestMode` ao abrir cada WebSocket. Até receber `true`, o frontend não renderiza o botão — não há botão oculto por CSS, espaço reservado ou flash de conteúdo. Ao desconectar, a UI volta ao padrão desabilitado até receber a configuração da nova conexão. Se estiver desabilitado, o backend também recusa `room.create` com `mode: "test"` e retorna `FEATURE_DISABLED`, mesmo que alguém envie o comando manualmente. Criação e entrada em salas normais continuam funcionando.

Na tela inicial, preencha **Seu apelido** e toque em **Testar com 2 bots**. A sala de espera já inclui você, **Bot Sem Filtro** e **Bot Mau Conselho**. Ajuste a pontuação, se quiser, e toque em **Começar a partida**.

- A interface mostra **Modo de teste** e identifica os bots no placar. Não oferece convite; outros jogadores não podem entrar nessa sala.
- Você começa como juiz para testar o julgamento imediatamente. Depois, o juiz alterna entre você e os dois bots.
- Bots escolhem cartas aleatoriamente da própria mão e, como juízes, escolhem aleatoriamente uma opção válida. Não usam IA ou serviços externos, nem tentam avaliar o humor das respostas.
- Usam as mesmas funções de regras do jogo normal: fases, quantidades e ordem das cartas, compra de extras, anonimato, pontuação e vitória. Não existem atalhos para conceder pontos ou ignorar validações.
- Para dar tempo de observar a UI, cada bot responde após pelo menos 1,5 segundo e julga após pelo menos 2,5 segundos. A manutenção do servidor verifica esses prazos a cada segundo, sem timers ou sockets extras por bot.
- Desconectar ou usar a pausa coletiva congela a partida e pausa os bots. Recarregar a mesma aba recupera sua participação, mãos, respostas e os mesmos dois bots, dentro do prazo de reconexão. Os atrasos dos bots são reagendados ao retomar.
- Sair ou expirar sua sessão remove a sala inteira, inclusive os bots. Eles não mantêm uma sala abandonada viva. Reinícios também perdem o teste, como qualquer partida em memória.
- Para testar novamente, volte ao início e crie outro teste. As salas normais continuam exigindo três pessoas e nunca recebem bots automaticamente.

Quando a flag está habilitada, o modo está disponível na aplicação, inclusive quando hospedada; não é uma ferramenta administrativa nem usa login especial. Cada pessoa pode criar seu próprio teste, sujeito aos mesmos limites de salas/conexões. O isolamento permite somente o criador e suas reconexões por token, não convidados pelo código. Os testes automatizados de bots/áudio habilitam a opção explicitamente em seus servidores temporários, sem depender do seu `.env`.

O Vite encaminha `/ws`, `/api` e `/health` para a porta 3000. A porta do backend pode ser alterada com `PORT`, mas nesse caso ajuste também o proxy de desenvolvimento.

### Aparência

O juiz aparece em uma faixa com martelo acima da pergunta e com destaque e marcador **Juiz** no placar. A própria pessoa vê **Você é o juiz desta rodada**. Os indicadores acompanham o rodízio e a reconexão; as instruções diferenciam envio de respostas e julgamento, inclusive no mobile e nos dois temas.

A tela inicial mostra uma mesa de cozinha, substituída no lobby pelos lugares dos participantes reais. A cena está em escala real (1 unidade = 10 cm): mesa de 2,0 × 0,9 m a 75 cm do chão, cadeiras com assento a 46 cm, cartas na proporção 5:7 das cartas de baralho (8,4 × 11,8 cm), levemente arqueadas e com sombra de contato. Um pendente quente ilumina a mesa e a luz cai em direção ao resto da cozinha. O tampo de carvalho tem um pano xadrez, uma caneca, um copo e a última fatia de pizza nos cantos. Os nomes dos jogadores aparecem em etiquetas junto às cadeiras. O martelo acompanha o juiz no rodízio. A combinação vencedora aparece em dourado. Quem usa movimento reduzido vê as mesmas mudanças de estado sem deslocamentos ou viradas animadas.

O botão de sol/lua no cabeçalho alterna entre tema claro e escuro, no jogo e no catálogo. Sem uma escolha salva, a interface acompanha o tema do sistema. A escolha manual fica em `localStorage` (`fdh.theme`), persiste ao recarregar e sincroniza entre abas da mesma origem. Se o armazenamento estiver bloqueado, a troca continua funcionando naquela página. Alterar o tema não recarrega o jogo nem interfere na sessão. Cartas de resposta permanecem brancas nos dois temas; instruções adicionais ficam nas regras recolhidas do lobby.

### Comandos

| Comando | Uso |
| --- | --- |
| `bun run dev:server` | Backend com watch; alterações reiniciam e apagam as salas. |
| `bun run dev:client` | Frontend Vite. |
| `bun run typecheck` | Verificação de tipos do servidor e cliente. |
| `bun test` | Testes de regras, privacidade, protocolo e HTTP/WebSocket reais. |
| `bun run test:mobile` | Build e validação mobile em Chromium/Android e WebKit/iPhone. |
| `bun run test:3d` | Build e partida com seleção pelo cenário WebGL, troca de câmera e perda do contexto em Chromium. |
| `bun run test:audio` | Build e validação de áudio em Chromium e WebKit, com nós Web Audio reais. |
| `bun run build` | Gera `client/dist`. |
| `bun run start` | Servidor de produção na porta 3000 ou em `PORT`. |

### Validação mobile

O frontend foi ajustado para uso por toque: controles de pelo menos 44 px, campos com fonte mínima de 16 px em mobile (evita zoom automático no Safari), teclado numérico para pontuação e áreas seguras de telas com recortes. O zoom manual continua permitido. A interface utiliza a altura dinâmica do viewport e mantém a rolagem normal quando a área útil diminui. A mão mantém duas colunas até 320px; no catálogo, telas abaixo de 360px usam uma coluna.

Para repetir a validação local:

1. Execute `bun install --frozen-lockfile`.
2. Instale os navegadores de teste: `bunx playwright install chromium webkit`.
3. Execute `bun run test:mobile`.

O script `scripts/mobile-smoke.ts` inicia servidores temporários em portas livres e os encerra ao terminar. Usa Playwright **somente como dependência de desenvolvimento**; não adiciona bibliotecas ao frontend nem executa navegadores no processo de produção. O deploy normal do Render continua usando os testes rápidos (`bun test`), sem instalar ou iniciar navegadores.

O teste mobile cobre:

- Chromium com perfil Android e WebKit com perfil iPhone, com eventos de toque.
- Temas claro/escuro e larguras de 320, 360, 375, 390, 430, 768 e 844 px, incluindo paisagem.
- Entrada por código e convite, configuração da sala, apelidos longos e cópia manual de convite quando o clipboard não está disponível.
- Catálogo, filtros, texto longo, paginação e retorno ao início da lista.
- Partida completa com três participantes, respostas de 1/2/3 cartas, compra de extras, julgamento, vitória e reconexão.
- Partida individual completa com dois bots: entrada pelo botão de teste, distinção visual dos bots, julgamento automático, rodízio, reconexão e saída.
- Flag de bots habilitada/desabilitada: botão ausente do DOM por padrão, sem flash enquanto aguarda configuração; salas normais preservadas.
- Barra fixa com espaço reservado, revisão da pergunta durante a rolagem, lacunas preenchidas com a seleção, espaços numerados, substituição e reordenação.
- Cabeçalho compacto e menu com Escape, sequência de fases e instrução do juiz; envio com selo e moldura da vencedora.
- Intervalo automático/manual, histórico com pergunta/autor, classificação final e movimento reduzido. Reconectar durante resultado não repete a celebração.
- Prazos reais: aviso nos últimos dez segundos, juiz inativo cancelado sem pontos, pausa/reconexão e relógio local adiantado sem afetar o prazo autoritativo.
- Identificação correta e única do juiz acima da pergunta e no placar, instruções por papel e atualização dos destaques no rodízio e após reconexão.
- Ausência de rolagem horizontal, texto recortado e erros JavaScript; tamanho mínimo dos alvos e dos campos.
- Contraste mínimo de 4.5:1 nos tokens principais de texto/controles, respostas brancas com texto preto e cor da barra do navegador sincronizada ao tema.
- Formulários com área útil reduzida e busca que libera o foco ao confirmar; uma nova rodada volta à pergunta.

**Limite da validação:** são navegadores com emulação mobile, não aparelhos físicos. No Chromium, `test:mobile` e `test:audio` rodam sem WebGL (`--disable-3d-apis`) e validam a vista clássica: o Chromium headless só oferece GPU por software (SwiftShader, sem compilação paralela de shaders), e várias mesas 3D simultâneas travariam as páginas além dos limites de tempo. A mesa 3D no Chromium é coberta por `test:3d`, e o WebKit continua usando WebGL nos testes mobile e de áudio. A área reduzida simula o espaço ocupado pelo teclado, mas não abre um teclado nativo de Android/iOS. Antes de compartilhar amplamente, é recomendável uma conferência em um Android e um iPhone reais, especialmente de teclado, clipboard, barra do navegador e interrupções de rede.

### Sons

Abra o ícone de alto-falante no cabeçalho para **silenciar/ativar** e ajustar o volume. A preferência fica salva em `localStorage` (`fdh.audio`) e sincroniza entre abas. Padrão: efeitos ativados com volume de 35%. Volume zero também silencia. O ajuste tem um clique de prévia ao soltar o controle ou usar as teclas de navegação. Clique fora ou pressione Escape para fechar o controle.

| Momento | Efeito |
| --- | --- |
| Selecionar carta ou opção de julgamento | Papel com estalo suave, somente no próprio navegador; três variações discretas e altura crescente para 1ª/2ª/3ª carta. |
| Remover ou mover uma carta | Deslize curto de papel, diferente da seleção. |
| Limpar combinação | Um único som de recolher, não um toque para cada carta. |
| Própria resposta confirmada no snapshot do servidor | Carta pousando na mesa e confirmação discreta; envio rejeitado não toca. |
| Nova rodada | Distribuição curta de cartas. |
| Nova rodada em que você é juiz | Uma breve indicação de madeira, no lugar da distribuição comum. |
| Julgamento pronto (`submitting → judging`) | Duas batidas de madeira só para o juiz; os demais recebem uma transição discreta. O último a enviar recebe sua confirmação de envio, sem sobrepor dois avisos. |
| Juiz confirma a vencedora | Martelo curto seguido das notas de resultado, somente após o snapshot autoritativo confirmar a escolha. |
| Ganhar um ponto | Revelação comum seguida de uma assinatura extra de duas notas brincalhonas, só para o vencedor. |
| Resultado | Vinheta curta, sem duplicar pelo evento e pelo snapshot. |
| Você vence a partida | Vinheta própria de aproximadamente 1,4 segundo; demais jogadores recebem um encerramento mais curto. |

Os efeitos usam **Web Audio API nativa** em três famílias: papel/deslize/toque seco para cartas, madeira/martelo para mesa e juiz, notas curtas para celebração. Texturas são sintetizadas com um pequeno buffer de ruído reutilizável, filtros e envelopes; impactos combinam ruído e corpo tonal. Seleção, remoção, limpeza, envio e distribuição têm três variações leves de altura/duração, sem variar o ganho. Efeitos comuns duram menos de um segundo; o campeão recebe uma vinheta própria de cerca de **1,4 segundo**, distinguível desde a primeira nota. Os demais recebem um encerramento mais curto; o juiz tem martelo integrado a esse encerramento, em vez de dois efeitos concorrentes. Sem arquivos de áudio, downloads, dependências ou serviços externos. Há um único contexto por página, no máximo 12 vozes e limpeza de fontes, filtros e envelopes após tocar, silenciar ou ocultar a aba.

Prioridades explícitas: **vitória/encerramento → resultado/ponto → chamada para agir → confirmação → interação**. Um som de prioridade menor é descartado enquanto outro mais importante toca, sem fila atrasada e sem interrompê-lo. Prioridades iguais podem coexistir dentro do teto de vozes; uma prioridade maior substitui as inferiores. Interface tem ganho menor e celebrações recebem presença moderada, sem grandes saltos de volume. O início da próxima rodada, por exemplo, não corta uma confirmação de envio ainda tocando.

O contexto só é criado após interação real por toque/clique/teclado. O primeiro toque após carregar ou recarregar pode apenas liberar o áudio, especialmente no Safari/iOS; os efeitos seguintes funcionam após a liberação. Não há tentativa de contornar as políticas de autoplay. Se o navegador/dispositivo não liberar áudio, a partida continua normalmente, sem sons ou erros de UI.

O primeiro snapshot de uma sessão recuperada é silencioso. Sons não se repetem em snapshots idênticos ou ao reconectar, inclusive a chamada de julgamento pronto. Respostas individuais dos outros jogadores e dos bots não geram cliques ou confirmações locais; a mudança de fase é anunciada uma única vez, sem lembretes. Eventos recebidos em mute, volume zero ou aba oculta são descartados, sem tocar uma fila atrasada ao voltar. Nenhuma ação, carta ou informação privada é enviada por causa do áudio: ele não envia comandos nem modifica as regras do backend.

Para testar: instale os navegadores com `bunx playwright install chromium webkit` e execute `bun run test:audio`. O script cobre desbloqueio por interação, volume/mute persistidos, efeitos, snapshots duplicados, reconexão, aba oculta, falha de reprodução e ausência de Web Audio/armazenamento. A instrumentação é exclusiva do teste; não adiciona objetos de debug à aplicação. Os testes rápidos também cobrem as prioridades dos efeitos, vitória, preferências inválidas e duração/ganho limitados. A validação automatizada verifica eventos e nós reais, **não substitui escutar em um aparelho físico**.

## Regras

- De 3 a 8 participantes; entrada somente antes do início.
- Cada participante recebe sete respostas privadas.
- Primeiro juiz sorteado; depois, rodízio pela ordem de entrada.
- Uma pergunta por rodada; cada participante, exceto o juiz, envia uma combinação de 1, 2 ou 3 cartas, conforme indicado na pergunta.
- A ordem escolhida é preservada no julgamento e no resultado. Uma combinação vencedora vale um ponto, não um ponto por carta.
- Em `[DRAW 2, PICK 3]`, cada participante que responde recebe duas cartas extras antes de escolher três; o juiz não recebe extras.
- Antes de cada rodada, as mãos voltam a sete cartas e recebem os extras da nova pergunta. Extras não utilizados de rodadas canceladas são descartados, sem acumular.
- O haiku usa três cartas como três linhas; o jogo não valida métrica ou sílabas.
- Respostas enviadas não podem ser trocadas.
- O juiz escolhe entre opções embaralhadas sem autoria.
- O vencedor recebe um ponto; o resultado fica visível por **15 segundos por padrão**. No lobby, o anfitrião escolhe 5, 10, 15, 20 ou 30 segundos, ou **avanço apenas pelo anfitrião**. Ele também pode antecipar o avanço de um resultado com intervalo automático. A contagem para a próxima rodada fica visível.
- Vence quem atingir a meta, configurável entre 3 e 20 pontos; padrão 5.
- Cada fase de respostas/julgamento tem **60 segundos por padrão**, configuráveis no lobby: 30, 60, 90, 120 ou 180 segundos, ou **sem limite**. O julgamento recebe um prazo novo, independente do tempo gasto para responder. Um aviso discreto aparece nos últimos dez segundos, sem som extra.
- No fim do prazo de respostas, as combinações recebidas vão ao julgamento; ausentes ficam de fora, sem envio automático nem perda das cartas ainda na mão. Se ninguém respondeu, a rodada é cancelada sem pontos e o juiz muda.
- Juiz inativo até o fim do prazo: rodada cancelada sem pontos, cartas enviadas descartadas e juiz seguinte. Não há prêmio automático. Em “sem limite”, respostas e julgamento continuam aguardando as pessoas.
- **Pausa coletiva:** qualquer participante pode pausar ou retomar para todos, inclusive no resultado. Ela congela o tempo restante, não reinicia o prazo. A pausa por desconexão é independente: limpar uma não remove a outra. Sair/expirar a sessão ainda segue as regras normais de cancelamento/encerramento.
- O servidor controla todos os prazos e verifica a expiração antes de executar comandos, inclusive entre ciclos da manutenção (a cada segundo). Uma ação recebida no instante do vencimento já é atrasada. O relógio do navegador é apenas uma indicação baseada no tempo informado pelo servidor; não concede prorrogação nem pontos.
- O **histórico** mostra as últimas 30 combinações vencedoras, da mais recente para a mais antiga, com pergunta, ordem das cartas e autor. Só entra depois do julgamento aceito; não revela autoria das opções em disputa nem guarda rodadas canceladas. Continua disponível ao reconectar e no fim da partida, apenas enquanto a sala existir em memória.
- Para revanche, saia e crie uma nova sala.

### Escolher e editar no celular

- A combinação fica em **um único lugar: a barra de envio**. No celular ela é fixa no rodapé, compacta, com espaço reservado dinamicamente e respeito à área segura do aparelho. No desktop flutua no fim da mão, sempre ao alcance. Some após o envio, ao julgar ou encerrar.
- A barra mostra um espaço numerado por carta, com o começo do texto escolhido, o relógio e o envio. Em perguntas de uma carta, o espaço e o botão dividem a mesma linha.
- **As lacunas da pergunta são preenchidas ao vivo** com as cartas escolhidas, em ordem, para ler a piada inteira antes de enviar. No celular, toque em **Pergunta** na barra para revisar a frase preenchida e o texto completo das cartas sem voltar ao início da tela. Perguntas sem lacuna continuam mostrando as cartas em lista.
- Toque em um espaço para escolher qual substituir e depois em outra carta da mão. As demais cartas não são bloqueadas quando a combinação está cheia. As setas movem a carta do espaço ativo para antes/depois; **✕** remove só aquela carta; **Limpar** esvazia tudo. Todos os espaços precisam estar preenchidos antes de enviar, e a barra avisa quantas cartas faltam.
- Cartas disponíveis têm acabamento de papel e sombra curta; foco/hover elevam levemente; selecionadas ganham borda forte, elevação e o número da ordem no canto. A combinação enviada fica agrupada com selo “Enviada”; a vencedora recebe moldura e destaque “+1 ponto”. No celular não há leque nem sobreposição entre cartas.
- A mão mantém duas colunas mesmo em 320px, com cartas mais compactas e texto completo. Controles têm alvo de toque mínimo de 44px.
- **Após enviar, não será possível alterar.** Antes de enviar, a edição é local; servidor continua validando quantidade, cartas únicas, propriedade e ordem.

### Mesa, revelação e navegação

- No desktop, a mesa 3D e o painel com o texto completo da pergunta ficam lado a lado; a mão e o placar aparecem abaixo. No celular, a mesa compacta vem primeiro, seguida da pergunta, da jogada, do placar e do histórico. A sequência **Responder → Julgar → Resultado** indica a fase atual; a instrução principal reflete o papel local (por exemplo, “Escolha 2 cartas” ou “Sua vez de julgar”).
- O relógio mostra o tempo e uma barra que esvazia; nos últimos dez segundos ela muda de cor. O placar mostra a meta, a pontuação e o progresso de cada pessoa até ela.
- Enquanto as respostas chegam, juiz e quem já enviou veem **uma carta virada por resposta esperada**, sem revelar quem enviou. No julgamento, a pergunta é preenchida com a combinação que o juiz tocou, e cada pessoa reconhece a própria combinação pelo marcador **Sua resposta**, visível só para ela. A barra de escolha do juiz acompanha a tela depois que uma combinação é tocada.
- O cabeçalho fica compacto durante a partida: marca curta, sala e conexão, áudio e menu. Catálogo, convite, tema e saída ficam no menu secundário, que fecha com Escape, toque fora ou escolha de ação. No lobby, o código da sala e o botão de convite ficam em destaque no próprio painel da sala de espera.
- A revelação preenche a pergunta com a combinação vencedora em dourado, destaca as cartas, mostra autor com avatar de iniciais e marca “+1” perto do placar. O histórico guarda cada pergunta já preenchida. Movimentos curtos e oito partículas decorativas de cartas/estrelas não escondem o texto nem atrasam a leitura. Respeitam `prefers-reduced-motion`; snapshots repetidos, reconexões e resultados recebidos em aba oculta não repetem a celebração. A próxima rodada continua sob controle do servidor.
- A vitória final abre com o campeão em destaque, seguido da classificação final e da última combinação vencedora. Ainda não existe revanche na mesma sala: a ação principal volta ao início para criar outra partida.
- As carinhas têm funções: curiosa no lobby, pensativa na escolha, desconfiada com martelo no julgamento, travessa no resultado e sonolenta na reconexão. São SVGs locais decorativos, sempre acompanhados por texto que explica o estado.
- A paleta rosa continua nas ações e seleções. Vitória usa dourado suave próprio, com selos/estrelas/rabiscos discretos. Títulos e cartas usam a mesma pilha arredondada de fontes do sistema; as cartas mantêm o conteúdo integral. Entrada, seleção e pontuação usam movimentos curtos no mesmo fluxo dos sons, sem dependências adicionais.

## Sessão e desconexão

O servidor gera um token aleatório de 32 bytes por participação. O navegador o guarda em `sessionStorage`: recarregar a mesma aba preserva a sessão; fechar a aba ou trocar de dispositivo pode perdê-la. Apelido e código não recuperam a identidade. Não compartilhe o token.

Um heartbeat a cada 30 segundos detecta conexões sem resposta em até 60 segundos. Após a detecção, o jogador tem mais 60 segundos para reconectar. Uma nova conexão com o mesmo token substitui a antiga, sem duplicar participante.

- Desconexão durante jogo: pausa, preservando mão, resposta e pontos.
- Reconexão no prazo: preserva a fase anterior e o tempo restante de respostas, julgamento ou resultado. Se a pausa coletiva estiver ativa, continua pausado até alguém retomar.
- Saída voluntária: remoção imediata e invalidação da credencial.
- Saída definitiva durante envio/julgamento: cancela a rodada sem ponto. Com pelo menos três participantes restantes, prepara outra rodada; se algum ainda estiver no prazo de reconexão, mantém a pausa.
- Saída após pontuação: não desfaz pontos já concedidos.
- Menos de três participantes: encerra sem declarar vencedor por pontuação.
- Anfitrião removido: função passa ao participante conectado mais antigo, ou ao mais antigo restante.
- Sem participantes: sala removida imediatamente. Salas sem conexões também têm limite de cinco minutos; normalmente as sessões expiram antes disso.
- Resultado final: sala removida após 15 minutos.

**Não há persistência. Suspensão, reinício, crash ou deploy apagam todas as partidas.** A reconexão só funciona enquanto o estado continuar no mesmo processo.

## Estrutura e estado

- `client/src/connection/`: socket, credencial, reconexão e confirmações.
- `client/src/audio/`: preferências, detecção de mudanças de estado e sintetizador Web Audio.
- `client/src/screens/`: entrada, lobby, partida e catálogo.
- `client/src/components/`: cartas e participantes.
- `shared/protocol.ts`: contrato público, sem estado privado do servidor.
- `server/src/connections.ts`: transporte Bun, origem, heartbeat, rate limit e backpressure.
- `server/src/protocol.ts`: validação em runtime; tipos TypeScript não substituem validação.
- `server/src/rooms.ts`: salas, sessões, conexões lógicas, deduplicação e expiração.
- `server/src/game.ts`: fases, respostas, julgamento, pontuação e rodízio.
- `server/src/bots.ts`: dois participantes automáticos por sala de teste, com agendamento pela manutenção existente e aplicação das mesmas regras.
- `server/src/cards.ts`: catálogo, embaralhamento e reciclagem.
- `server/src/projections.ts`: snapshots personalizados, sem serializar o estado interno.
- `server/src/http.ts`: arquivos estáticos, catálogo público e health check.
- `shared/logging.ts`: logs JSON com campos permitidos, sem payloads privados.
- `server/cards/`: arquivos fonte do catálogo, carregados pelo servidor.

Os módulos de regras e salas executam alterações sincronamente, sem `await` entre validação e aplicação. Não há locks nem múltiplos workers. Cada mudança incrementa a versão da sala. O frontend substitui seu estado pelo snapshot; não calcula pontuação ou distribui cartas.

Durante envio, somente a contagem global é pública. No julgamento, opções têm IDs novos e não incluem IDs originais, ordem de chegada ou autoria. O anonimato é casual, não proteção contra conluio ou inferências de timing. Na vitória, somente a autoria da resposta vencedora é revelada.

### Cartas

Os dois JSONs contêm listas de objetos com `id` e `text`. Perguntas podem informar `pick` (1–3, padrão 1) e `draw` (0–2, padrão 0). Os marcadores no texto são visuais; as regras usam esses campos, não contam lacunas. IDs devem ser únicos entre ambos os arquivos. O catálogo atual tem 90 perguntas e 459 respostas.

O catálogo é validado antes de o servidor iniciar: precisa de pelo menos uma pergunta e `8 × 7 + 7 × maior draw` respostas. Com compra de duas cartas extras, o mínimo é 70, garantindo cartas suficientes para oito jogadores.

Cada sala mantém suas próprias pilhas de IDs; os textos são compartilhados no processo. Cartas em mãos ou rodadas ativas nunca voltam ao monte. Descartes são reembaralhados quando necessário.

### Página de catálogo

Abra `/cards` ou use **Ver cartas** no cabeçalho. A página tem abas para perguntas/respostas, busca por texto ou ID sem diferenciar acentos, filtro de quantidade de cartas por resposta e paginação de 24 itens. O link abre outra aba para não interromper uma partida. Não cria socket nem recupera sessão de jogo.

`GET /api/cards` retorna somente o catálogo editorial, com cache de 60 segundos. Não inclui participantes, mãos, autoria, tokens, ordem embaralhada ou dados das salas. O catálogo é público; o estado das partidas permanece privado. Alterações nos JSONs precisam de reinício do backend para serem carregadas.

## Protocolo

Comandos JSON possuem `type`, `requestId` e `payload`. O servidor responde `command.ok` ou `command.error` com o mesmo identificador. Heartbeats são a exceção e usam `nonce`.

| Comando | Payload | Autorização / fase |
| --- | --- | --- |
| `room.create` | `nickname`, `targetScore` opcional, `mode` opcional (`private` ou `test`) | Conexão sem participação; padrão `private`. |
| `room.join` | `code`, `nickname` | Lobby com vaga. |
| `session.resume` | `code`, `token` | Credencial válida e no prazo. |
| `room.leave` | Objeto vazio | Participante atual. |
| `room.configure` | `targetScore`, `phaseTimeLimitSeconds?`, `resultIntervalSeconds?` | Anfitrião no lobby; `null` significa sem limite de fase/avanço manual do resultado. Campos omitidos preservam a configuração. |
| `game.pause` | `roundId`, `paused` | Qualquer participante, em rodada ativa ou resultado. Estado desejado explícito, não toggle. |
| `round.advance` | `roundId` | Só anfitrião durante resultado não pausado; pode antecipar o intervalo automático. |
| `game.start` | Objeto vazio | Anfitrião, 3–8 pessoas conectadas. |
| `round.submit` | `roundId`, `cardIds` em ordem | Não juiz, envio, quantidade exata, cartas próprias distintas, sem resposta prévia. |
| `round.judge` | `roundId`, `optionId` | Juiz, julgamento, opção atual. |
| `connection.pong` | `nonce` | Heartbeat pendente da conexão. |

Eventos: `server.config`, `command.ok`, `command.error`, `state.snapshot`, `round.result`, `round.cancelled`, `session.replaced`, `room.closed`, `server.restarting` e `connection.ping`.

`server.config` é enviado ao abrir a conexão e expõe apenas `features.botTestMode` como booleano. Nenhuma variável de ambiente bruta ou segredo é enviado. Configuração não é um comando aceito do cliente; a autorização do modo de teste continua sendo validada no servidor.

`state.snapshot` contém estado público e `self` privado. Eventos de estado têm `roomCode` e `version`. O resultado também permanece no snapshot para suportar reconexão. A credencial só é enviada ao solicitante na confirmação de criar/entrar.

O snapshot inclui `serverNow`, `room.collectivelyPaused`, `room.history`, `round.deadlineAt`/`remainingPhaseMs` e `round.nextRoundAt`/`remainingResultMs`. Durante pausa, o deadline fica `null` e o restante é congelado em milissegundos. “Sem limite”/resultado manual não têm deadline nem restante. A indicação `room.paused` combina as pausas coletiva e de desconexão. Histórico é limitado a 30 entradas para manter o estado e os snapshots limitados.

O snapshot inclui `round.prompt.pick` e `draw`. `self.submittedResponses` preserva as cartas enviadas em ordem. Opções de julgamento usam `id` aleatório e `responses` (textos ordenados, sem IDs originais ou autoria). O resultado usa `responseTexts` para a combinação vencedora.

O estado público inclui `room.mode` e `players[].isBot`. Bots não possuem credenciais de sessão. Salas de teste recusam `room.join` com `TEST_ROOM_PRIVATE`; somente a sessão humana original pode reconectar. O payload não permite definir bots, IDs ou número de participantes automáticos arbitrariamente.

Os últimos 50 resultados de comandos são lembrados por até dois minutos por conexão/sessão. Repetições com o mesmo identificador e conteúdo não reaplicam ações; o mesmo ID com outro conteúdo é recusado. As regras de fase, rodada e envio único continuam protegendo contra duplicação após expirar o cache. Isso não constitui uma garantia de entrega exatamente uma vez pela rede.

## Limites e segurança

- 50 salas por processo, oito participantes por sala e 200 sockets no total.
- Mensagens de até 8 KB; somente texto JSON.
- Rate limit por conexão: dez mensagens/segundo, com rajada inicial de vinte.
- Mensagens binárias, campos inesperados e IDs de autoria forjados são rejeitados.
- Buffers de saída limitados a 64 KB; clientes lentos são desconectados.
- Apelidos têm 2–24 caracteres; duplicatas na sala e caracteres de controle são recusados.
- Tokens não aparecem em URLs, logs, snapshots públicos ou convites.
- HTTP serve `/`, `/cards`, assets do build, `/health` e `/api/cards`. Fontes TypeScript, arquivos JSON brutos e configuração não são públicos; somente o catálogo editorial é exposto pela API.
- Origem é validada no upgrade. Em produção, configure `PUBLIC_ORIGIN` ou utilize `RENDER_EXTERNAL_URL`.
- Sem HTML arbitrário, bibliotecas externas de fontes ou serviços de terceiros no frontend.

Esses limites reduzem abuso casual; não são proteção completa contra ataques distribuídos. A capacidade real deve ser medida antes de aumentar os limites.

## Produção local

Execute `bun run typecheck`, `bun test`, `bun run build` e `bun run start`. Abra `http://localhost:3000`. Em produção, o Vite não fica em execução.

## Logs e diagnóstico

Não há dependências ou serviço externo de logging. O backend escreve uma linha JSON por evento na saída padrão/erro, disponível também em **Logs** no Render. Não grava arquivos de log nem mantém histórico em memória.

- Padrão do backend: `LOG_LEVEL=info` (testes ficam silenciosos por padrão).
- Para investigar: `LOG_LEVEL=debug bun run dev:server` ou configure `LOG_LEVEL=debug` no Render e reinicie o serviço.
- Níveis: `debug`, `info`, `warn`, `error`, `silent`. Valor inválido usa o padrão.
- `info`: inicialização, catálogo carregado, conexões, criação/entrada/remoção de salas, reconexão, troca de anfitrião, início/fim de partidas, mudança de fase, início/resultado/cancelamento de rodada e pausas.
- `server.started` inclui `botTestModeEnabled`, permitindo conferir o valor efetivo da flag nos logs.
- `debug`: comandos recebidos/confirmados/repetidos, duração, contagens, heartbeat, backpressure e respostas HTTP. Health checks bem-sucedidos não geram logs.
- No navegador, `audio.played` registra somente o nome do efeito em `debug`. Falhas do dispositivo usam `audio.unavailable`, sem mensagens brutas ou conteúdo das cartas.
- No teste solo, `room.created` inclui `roomMode` e `bot.action_applied` registra comando, jogador técnico, rodada e versão em `debug`, sem cartas ou escolhas.
- `warn`/`error`: mensagens inválidas, comandos rejeitados, rate limit, heartbeat expirado, origem recusada, arquivos do build ausentes e falhas internas.

Campos como `instanceId` identificam a execução do processo; `connectionId`, `roomCode`, `playerId`, `roundId`, `version` e `requestId` ajudam a correlacionar eventos. Um reinício cria outro `instanceId`. O mesmo `requestId` conecta um comando no navegador ao processamento no servidor.

No navegador, os logs aparecem no console: padrão `info` em desenvolvimento e `warn` em produção. Para ativar detalhes temporariamente, execute `localStorage.setItem("fdh.logLevel", "debug")` no console e recarregue a página. Para restaurar o padrão: `localStorage.removeItem("fdh.logLevel")` e recarregue. Em produção, recomende aos amigos ativar isso apenas ao reproduzir um problema.

**Privacidade:** não são registrados tokens, apelidos, mãos, IDs/textos das cartas enviadas, opções escolhidas, payloads, snapshots completos, cabeçalhos, motivos arbitrários enviados pelo socket ou query strings. Logs de erros internos guardam categoria e locais do código, sem a mensagem/cause do erro, que podem conter dados sensíveis. Uma lista de campos permitidos limita a serialização mesmo em debug. Códigos de sala e IDs técnicos ainda podem aparecer: compartilhe logs somente com pessoas de confiança e remova-os se necessário.

As chaves antigas de sessão e apelido no armazenamento do navegador foram preservadas para não invalidar participações existentes por causa da mudança de nome.

## Render Free — um único serviço

1. Publique o monorepo em um repositório Git.
2. Crie um **Web Service**, plano **Free**, com o ambiente nativo Node/Bun (o Render disponibiliza Bun nativamente).
3. Mantenha o diretório raiz na raiz do repositório.
4. Defina `BUN_VERSION=1.4.3` para reproduzir o ambiente validado.
5. Build: `bun install --frozen-lockfile && bun run typecheck && bun test && bun run build`.
6. Start: `bun run start`.
7. Health check: `/health`.
8. Defina `PUBLIC_ORIGIN=https://seu-servico.onrender.com`, sem barra final. Se não definir, o servidor usa `RENDER_EXTERNAL_URL`, fornecida pelo Render. Em domínio personalizado, configure a origem explicitamente.
9. Deixe `ENABLE_BOT_TEST_MODE=false` (ou ausente) para não disponibilizar testes com bots; use `true` somente quando quiser habilitar esse modo.

Não fixe `PORT` no Render: use o valor fornecido pela plataforma. O processo escuta em `0.0.0.0`. Frontend e socket compartilham origem, porta e certificado HTTPS; o cliente usa `wss` automaticamente. Não crie um Static Site separado, worker ou segunda instância.

O Free pode suspender após 15 minutos sem tráfego de entrada, levar cerca de um minuto para retomar e reiniciar sem aviso. WebSocket não garante que a memória sobreviva. Novos deploys também perdem as partidas. Não use pings externos para tentar manter o serviço acordado.

Referências: [Free](https://render.com/docs/free), [linguagens/Bun](https://render.com/docs/language-support), [WebSockets](https://render.com/docs/websocket).
