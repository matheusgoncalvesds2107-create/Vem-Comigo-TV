/* VEM COMIGO TV — FUTEBOL POR PARTIDA */

const futebolTV = {
  jogos: [],
  carregando: false
};

async function buscarJogosTV() {
  futebolTV.carregando = true;

  try {
    const resposta = await fetch(
      "/api/games/today",
      { cache: "no-store" }
    );

    if (!resposta.ok) {
      throw new Error("HTTP " + resposta.status);
    }

    const dados = await resposta.json();

    futebolTV.jogos = Array.isArray(dados)
      ? dados
      : dados.response ||
        dados.games ||
        dados.matches ||
        [];

  } catch (erro) {
    futebolTV.jogos = [];
    console.warn("Futebol TV:", erro.message);
  }

  futebolTV.carregando = false;
  mostrarJogosTV();
}

function nomeTimeTV(valor) {
  if (typeof valor === "string") return valor;
  return valor?.name || "";
}

function mostrarJogosTV() {
  const grade = document.querySelector("#grid");
  if (!grade) return;

  grade.replaceChildren();

  const titulo = document.querySelector("#sectionTitle");
  const contador = document.querySelector("#sectionCount");
  const mais = document.querySelector("#more");
  const vazio = document.querySelector("#empty");

  if (titulo) titulo.textContent = "Futebol na TV";
  if (contador) {
    contador.textContent =
      futebolTV.jogos.length + " partidas";
  }

  if (mais) mais.hidden = true;
  if (vazio) vazio.hidden = true;

  if (!futebolTV.jogos.length) {
    const aviso = document.createElement("p");
    aviso.textContent =
      "Nenhum jogo disponível. Verifique a fonte de partidas.";
    grade.append(aviso);
    return;
  }

  for (const jogo of futebolTV.jogos) {
    const mandante = nomeTimeTV(
      jogo.home_team ||
      jogo.homeTeam ||
      jogo.teams?.home ||
      jogo.home
    ) || "Mandante";

    const visitante = nomeTimeTV(
      jogo.away_team ||
      jogo.awayTeam ||
      jogo.teams?.away ||
      jogo.away
    ) || "Visitante";

    const campeonato = nomeTimeTV(
      jogo.league || jogo.competition
    ) || "Futebol";

    const card = document.createElement("article");
    card.className = "tile";

    card.style.cssText = `
      grid-column: span 2;
      background: #151b29;
      border: 1px solid #30384a;
      border-radius: 16px;
      padding: 20px;
      color: white;
      text-align: center;
    `;

    const liga = document.createElement("h3");
    liga.textContent = campeonato;

    const times = document.createElement("h2");
    times.textContent =
      mandante + "  VS  " + visitante;

    const botao = document.createElement("button");
    botao.type = "button";
    botao.textContent = "Ver canais disponíveis";

    botao.style.cssText = `
      background: #d51e38;
      color: white;
      border: none;
      border-radius: 10px;
      padding: 12px 20px;
      font-weight: bold;
    `;

    botao.onclick = () => {
      abrirCanaisDoJogoTV(mandante, visitante);
    };

    card.append(liga, times, botao);
    grade.append(card);
  }
}

function abrirCanaisDoJogoTV(mandante, visitante) {
  const canais = state.entries.filter(
    canal => canal.type === "esportes"
  );

  if (!canais.length) {
    toast("Importe uma playlist esportiva primeiro.");
    return;
  }

  const janela = document.createElement("dialog");

  janela.style.cssText = `
    background: #111827;
    color: white;
    border: 1px solid #374151;
    border-radius: 16px;
    padding: 20px;
    width: 90%;
    max-width: 420px;
  `;

  const titulo = document.createElement("h3");
  titulo.textContent =
    mandante + " x " + visitante;

  const aviso = document.createElement("p");
  aviso.textContent =
    "Escolha um canal. A transmissão da partida não foi confirmada.";

  janela.append(titulo, aviso);

  for (const canal of canais.slice(0, 100)) {
    const botao = document.createElement("button");

    botao.textContent = canal.name;
    botao.style.cssText = `
      display: block;
      width: 100%;
      margin: 6px 0;
      padding: 12px;
      color: white;
      background: #273449;
      border: none;
      border-radius: 8px;
    `;

    botao.onclick = () => {
      janela.close();
      play(canal);
    };

    janela.append(botao);
  }

  const fechar = document.createElement("button");
  fechar.textContent = "Fechar";
  fechar.onclick = () => janela.close();

  janela.append(fechar);
  janela.onclose = () => janela.remove();

  document.body.append(janela);
  janela.showModal();
}

// Atualiza a aba Esportes para Futebol na TV.
document.querySelectorAll('[data-tab="esportes"]')
  .forEach(botao => {
    botao.addEventListener("click", () => {
      setTimeout(buscarJogosTV, 0);
    });
  });
