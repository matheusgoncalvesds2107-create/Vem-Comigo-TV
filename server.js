
'use strict';

// ======================================
// VEM COMIGO TV — SERVIDOR COMPLETO
// TV + FILMES + SÉRIES + FUTEBOL
// ======================================

const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const PORT = process.env.PORT || 10000;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const allowedHost =
  process.env.M3U_ALLOWED_HOST ||
  '195.181.163.138';

// ======================================
// FUNÇÕES AUXILIARES
// ======================================

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type':
      'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });

  res.end(JSON.stringify(data));
}

function safe(value) {
  return String(value ?? '')
    .replace(/[\r\n"<>]/g, ' ')
    .slice(0, 220);
}

function allowedXtreamHosts() {
  return (
    process.env.XTREAM_ALLOWED_HOSTS || ''
  )
    .split(',')
    .map(x => x.trim().toLowerCase())
    .filter(Boolean);
}

async function readJsonResponse(
  url,
  timeout = 20000,
  maxBytes = 48 * 1024 * 1024
) {
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(timeout),
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(
      'Servidor respondeu HTTP ' +
      response.status
    );
  }

  const chunks = [];
  let bytes = 0;

  for await (const chunk of response.body) {
    bytes += chunk.length;

    if (bytes > maxBytes) {
      throw new Error(
        'Catálogo excede o limite de tamanho.'
      );
    }

    chunks.push(chunk);
  }

  return JSON.parse(
    Buffer.concat(chunks).toString('utf8')
  );
}

function readRequestBody(req, max = 8192) {
  return new Promise((resolve, reject) => {
    let body = '';
    let total = 0;
    let rejected = false;

    req.on('data', chunk => {
      total += chunk.length;

      if (total > max) {
        rejected = true;
        reject(new Error('Requisição muito grande.'));
        req.destroy();
        return;
      }

      body += chunk;
    });

    req.on('end', () => {
      if (!rejected) resolve(body);
    });

    req.on('error', reject);
  });
}

// ======================================
// FUTEBOL — JOGOS REAIS
// ======================================

// Códigos das competições acompanhadas.
// A fonte pode não cobrir todas as ligas.

const FOOTBALL_LEAGUES = [
  { id: 'bra.1', name: 'Brasileirão Série A' },
  { id: 'bra.2', name: 'Brasileirão Série B' },
  { id: 'bra.copa_do_brasil', name: 'Copa do Brasil' },
  { id: 'conmebol.libertadores', name: 'Libertadores' },
  { id: 'conmebol.sudamericana', name: 'Sul-Americana' },
  { id: 'eng.1', name: 'Premier League' },
  { id: 'esp.1', name: 'La Liga' },
  { id: 'ita.1', name: 'Campeonato Italiano' },
  { id: 'ger.1', name: 'Bundesliga' },
  { id: 'fra.1', name: 'Campeonato Francês' },
  { id: 'uefa.champions', name: 'Champions League' },
  { id: 'uefa.europa', name: 'Europa League' }
];

const FOOTBALL_CACHE_MS = 3 * 60 * 1000;

const footballCache = new Map();

function brazilDate() {
  const parts = new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }
  ).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.map(p => [p.type, p.value])
  );

  return (
    values.year +
    values.month +
    values.day
  );
}

function normalizeGame(event, league) {
  const competition = event.competitions?.[0];

  if (!competition) return null;

  const competitors = competition.competitors || [];

  const home = competitors.find(
    team => team.homeAway === 'home'
  );

  const away = competitors.find(
    team => team.homeAway === 'away'
  );

  if (!home || !away) return null;

  const status = event.status || {};

  return {
    id: String(event.id),
    league: {
      id: league.id,
      name: league.name
    },

    date: event.date || competition.date || '',

    home_team: {
      name:
        home.team?.displayName ||
        home.team?.name ||
        'Mandante',
      logo: home.team?.logo || ''
    },

    away_team: {
      name:
        away.team?.displayName ||
        away.team?.name ||
        'Visitante',
      logo: away.team?.logo || ''
    },

    home_logo: home.team?.logo || '',
    away_logo: away.team?.logo || '',

    scores: {
      home: home.score ?? null,
      away: away.score ?? null
    },

    status: {
      short: status.type?.shortDetail ||
        status.type?.name ||
        '',
      state: status.type?.state || '',
      detail: status.type?.detail || '',
      clock: status.displayClock || ''
    },

    source: 'ESPN'
  };
}

async function getLeagueGames(league, date) {
  const endpoint = new URL(
    'https://site.api.espn.com/apis/site/v2/' +
    'sports/soccer/' +
    encodeURIComponent(league.id) +
    '/scoreboard'
  );

  endpoint.searchParams.set('dates', date);

  const response = await readJsonResponse(
    endpoint,
    12000,
    4 * 1024 * 1024
  );

  const events = Array.isArray(response.events)
    ? response.events
    : [];

  return events
    .map(event => normalizeGame(event, league))
    .filter(Boolean);
}

async function loadFootballGames(date) {
  const cached = footballCache.get(date);

  if (
    cached &&
    Date.now() - cached.time < FOOTBALL_CACHE_MS
  ) {
    return cached.data;
  }

  const results = await Promise.allSettled(
    FOOTBALL_LEAGUES.map(league =>
      getLeagueGames(league, date)
    )
  );

  const matches = [];
  let successfulSources = 0;

  for (const result of results) {
    if (result.status === 'fulfilled') {
      successfulSources++;

      matches.push(...result.value);
    }
  }

  if (successfulSources === 0) {
    throw new Error(
      'Nenhuma fonte de futebol respondeu.'
    );
  }

  const unique = new Map();

  for (const game of matches) {
    const key = String(game.id);

    if (!unique.has(key)) {
      unique.set(key, game);
    }
  }

  const games = [...unique.values()].sort(
    (a, b) =>
      new Date(a.date) - new Date(b.date)
  );

  const data = {
    ok: true,
    date,
    source: 'ESPN',
    updatedAt: new Date().toISOString(),
    count: games.length,
    successfulSources,
    totalSources: FOOTBALL_LEAGUES.length,
    games
  };

  footballCache.set(date, {
    time: Date.now(),
    data
  });

  // Evita crescimento indefinido do cache.
  if (footballCache.size > 12) {
    const first = footballCache.keys().next().value;
    footballCache.delete(first);
  }

  return data;
}

// ======================================
// XTREAM CODES
// ======================================

async function handleXtream(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, {
      error: 'Método não permitido.'
    });
  }

  try {
    const raw = await readRequestBody(req);

    const {
      server,
      username,
      password,
      format
    } = JSON.parse(raw);

    if (
      !username ||
      !password ||
      username.length > 160 ||
      password.length > 160 ||
      !['ts', 'm3u8'].includes(format)
    ) {
      throw new Error('Dados inválidos.');
    }

    const u = new URL(server);
    const hosts = allowedXtreamHosts();

    if (!hosts.length) {
      throw new Error(
        'Configure XTREAM_ALLOWED_HOSTS no Render.'
      );
    }

    if (
      !['http:', 'https:'].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.pathname !== '/' ||
      u.search ||
      u.hash ||
      !hosts.includes(u.hostname.toLowerCase())
    ) {
      throw new Error(
        'Servidor não autorizado nesta instalação.'
      );
    }

    const base = u.origin;

    const api = new URL(
      '/player_api.php',
      base
    );

    api.searchParams.set('username', username);
    api.searchParams.set('password', password);

    async function get(action) {
      const endpoint = new URL(api);

      if (action) {
        const [act, id] =
          action.split('&series_id=');

        endpoint.searchParams.set(
          'action',
          act
        );

        if (id) {
          endpoint.searchParams.set(
            'series_id',
            id
          );
        }
      }

      return readJsonResponse(endpoint);
    }

    const auth = await get();

    if (
      !auth.user_info ||
      String(auth.user_info.auth) !== '1'
    ) {
      throw new Error(
        'Conta não autorizada pelo servidor.'
      );
    }

    const live = await get('get_live_streams');
    const series = await get('get_series');
    const vods = await get('get_vod_streams');

    const lines = ['#EXTM3U'];

    function add(name, group, url, logo) {
      lines.push(
        '#EXTINF:-1 tvg-logo="' +
        safe(logo) +
        '" group-title="' +
        safe(group) +
        '",' +
        safe(name)
      );

      lines.push(url);
    }

    const authpath =
      encodeURIComponent(username) +
      '/' +
      encodeURIComponent(password);

    // CANAIS AO VIVO

    for (
      const channel of
      (Array.isArray(live) ? live : []).slice(0, 5000)
    ) {
      if (
        !/^\d+$/.test(
          String(channel.stream_id)
        )
      ) {
        continue;
      }

      add(
        channel.name,
        channel.category_name || 'TV ao vivo',
        base +
          '/live/' +
          authpath +
          '/' +
          channel.stream_id +
          '.' +
          format,
        channel.stream_icon
      );
    }

    // FILMES

    for (
      const movie of
      (Array.isArray(vods) ? vods : []).slice(0, 3000)
    ) {
      if (
        !/^\d+$/.test(
          String(movie.stream_id)
        )
      ) {
        continue;
      }

      const ext =
        /^[a-z0-9]{2,5}$/i.test(
          movie.container_extension || ''
        )
          ? movie.container_extension
          : 'mp4';

      add(
        movie.name,
        movie.category_name || 'Filmes',
        base +
          '/movie/' +
          authpath +
          '/' +
          movie.stream_id +
          '.' +
          ext,
        movie.stream_icon
      );
    }

    // NOVELAS E SÉRIES
    // Mantém o limite original de 30 séries.

    for (
      const show of
      (Array.isArray(series) ? series : []).slice(0, 30)
    ) {
      if (
        !/^\d+$/.test(
          String(show.series_id)
        )
      ) {
        continue;
      }

      let details;

      try {
        details = await get(
          'get_series_info&series_id=' +
          show.series_id
        );
      } catch {
        continue;
      }

      const seasons = details.episodes || {};

      for (
        const [season, episodes] of
        Object.entries(seasons)
      ) {
        for (
          const episode of
          (Array.isArray(episodes) ? episodes : [])
        ) {
          if (
            !/^\d+$/.test(
              String(episode.id)
            )
          ) {
            continue;
          }

          const ext =
            /^[a-z0-9]{2,5}$/i.test(
              episode.container_extension || ''
            )
              ? episode.container_extension
              : 'mp4';

          add(
            show.name +
              ' S' +
              season +
              ' E' +
              (episode.episode_num || '?'),
            show.category_name ||
              'Séries Turcas',
            base +
              '/series/' +
              authpath +
              '/' +
              episode.id +
              '.' +
              ext,
            show.cover
          );
        }
      }
    }

    return json(res, 200, {
      playlist: lines.join('\n')
    });

  } catch (error) {
    return json(res, 400, {
      error: error.message
    });
  }
}

// ======================================
// IMPORTAR PLAYLIST M3U
// ======================================

async function handlePlaylist(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, {
      error: 'Método não permitido.'
    });
  }

  try {
    const body = await readRequestBody(req);
    const input = JSON.parse(body);

    const u = new URL(input.url);

    if (
      !['http:', 'https:'].includes(u.protocol) ||
      u.hostname !== allowedHost ||
      (
        u.port &&
        u.port !== '80' &&
        u.port !== '443'
      ) ||
      u.pathname !== '/get.php'
    ) {
      throw new Error(
        'URL não permitida. Use a URL M3U ' +
        'do fornecedor configurado.'
      );
    }

    if (
      !u.searchParams.get('username') ||
      !u.searchParams.get('password')
    ) {
      throw new Error('URL M3U incompleta.');
    }

    const upstream = await fetch(u, {
      redirect: 'error',
      signal: AbortSignal.timeout(90000),
      headers: {
        'User-Agent': 'VemComigoTV/1.2',
        Accept: '*/*'
      }
    });

    if (!upstream.ok) {
      throw new Error(
        'Servidor da playlist respondeu HTTP ' +
        upstream.status
      );
    }

    const max = 120 * 1024 * 1024;

    let length = 0;
    const chunks = [];

    for await (const chunk of upstream.body) {
      length += chunk.length;

      if (length > max) {
        throw new Error(
          'Playlist muito grande.'
        );
      }

      chunks.push(chunk);
    }

    const data = Buffer.concat(chunks);

    if (
      !data
        .toString(
          'utf8',
          0,
          Math.min(data.length, 2048)
        )
        .includes('#EXTM3U')
    ) {
      throw new Error(
        'O endereço não retornou uma playlist M3U.'
      );
    }

    res.writeHead(200, {
      'Content-Type':
        'audio/x-mpegurl; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });

    res.end(data);

  } catch (error) {
    json(res, 400, {
      error:
        error.message ||
        'Falha ao importar.'
    });
  }
}

// ======================================
// SERVIDOR HTTP
// ======================================

const server = http.createServer(
  async (req, res) => {
    let pathname;

    try {
      pathname = new URL(
        req.url || '/',
        'http://localhost'
      ).pathname;
    } catch {
      return json(res, 400, {
        error: 'URL inválida.'
      });
    }

    // ROTA: TESTE DE SAÚDE

    if (pathname === '/api/health') {
      return json(res, 200, {
        ok: true,
        app: 'Vem Comigo TV',
        football: true,
        time: new Date().toISOString()
      });
    }

    // ROTA: PARTIDAS DE FUTEBOL

    if (pathname === '/api/games/today') {
      if (req.method !== 'GET') {
        return json(res, 405, {
          error: 'Método não permitido.'
        });
      }

      try {
        const requestURL = new URL(
          req.url,
          'http://localhost'
        );

        const date =
          requestURL.searchParams.get('date') ||
          brazilDate();

        if (!/^\d{8}$/.test(date)) {
          return json(res, 400, {
            error:
              'Data inválida. Use YYYYMMDD.'
          });
        }

        const data = await loadFootballGames(
          date
        );

        return json(res, 200, data);

      } catch (error) {
        return json(res, 502, {
          ok: false,
          error: error.message,
          games: []
        });
      }
    }

    // ROTA: XTREAM

    if (pathname === '/api/xtream') {
      return handleXtream(req, res);
    }

    // ROTA: PLAYLIST M3U

    if (
      pathname === '/api/import-playlist'
    ) {
      return handlePlaylist(req, res);
    }

    // ARQUIVOS DO SITE

    let decoded;

    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      res.writeHead(400);
      return res.end('URL inválida.');
    }

    if (
      decoded.includes('\0') ||
      decoded.includes('\\')
    ) {
      res.writeHead(400);
      return res.end('Caminho inválido.');
    }

    const dest = path.resolve(
      root,
      '.' + (
        decoded === '/'
          ? '/index.html'
          : decoded
      )
    );

    if (
      !dest.startsWith(root + path.sep) ||
      !fs.existsSync(dest) ||
      !fs.statSync(dest).isFile()
    ) {
      res.writeHead(404);
      return res.end('Não encontrado');
    }

    res.writeHead(200, {
      'Content-Type':
        types[path.extname(dest)] ||
        'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });

    fs.createReadStream(dest).pipe(res);
  }
);

server.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      'Vem Comigo TV online na porta ' +
      PORT
    );
  }
);
