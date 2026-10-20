'use strict';

/*
 * VEM COMIGO TV
 * Servidor web + jogos de futebol + escudos
 * Node.js 22 ou superior
 */

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';
const PUBLIC_DIR = __dirname;

const CACHE_TTL = 3 * 60 * 1000;
const footballCache = new Map();

/*
 * Competições ESPN.
 */
const FOOTBALL_LEAGUES = [
  { id: 'bra.1', name: 'Brasileirão Série A' },
  { id: 'bra.2', name: 'Brasileirão Série B' },
  { id: 'bra.copa_do_brasil', name: 'Copa do Brasil' },
  { id: 'conmebol.libertadores', name: 'Copa Libertadores' },
  { id: 'conmebol.sudamericana', name: 'Copa Sul-Americana' },
  { id: 'eng.1', name: 'Premier League' },
  { id: 'esp.1', name: 'La Liga' },
  { id: 'ita.1', name: 'Serie A Italiana' },
  { id: 'ger.1', name: 'Bundesliga' },
  { id: 'fra.1', name: 'Ligue 1' },
  { id: 'uefa.champions', name: 'Champions League' },
  { id: 'uefa.europa', name: 'Europa League' }
];

function todaySaoPaulo() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const get = type => parts.find(p => p.type === type)?.value;

  return `${get('year')}${get('month')}${get('day')}`;
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });

  res.end(JSON.stringify(data));
}

function requestJson(url, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 VemComigoTV/1.0',
        'Accept': 'application/json'
      },
      timeout
    }, response => {
      let body = '';

      response.setEncoding('utf8');

      response.on('data', chunk => {
        body += chunk;
      });

      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          return reject(
            new Error(`ESPN respondeu HTTP ${response.statusCode}`)
          );
        }

        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('A resposta da ESPN não é um JSON válido.'));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('Tempo limite ao consultar a ESPN.'));
    });

    req.on('error', reject);
  });
}

function getLogo(team) {
  if (!team || typeof team !== 'object') return '';

  /*
   * Prioriza o escudo informado pela ESPN.
   * Se não vier no placar, tenta formar a URL pelo ID do time.
   */
  if (typeof team.logo === 'string' && team.logo.trim()) {
    return team.logo.trim();
  }

  if (Array.isArray(team.logos) && team.logos.length) {
    const preferred =
      team.logos.find(item => item && item.href) ||
      team.logos[0];

    if (preferred && typeof preferred.href === 'string') {
      return preferred.href;
    }
  }

  if (team.id) {
    return `https://a.espncdn.com/i/teamlogos/soccer/500/${encodeURIComponent(team.id)}.png`;
  }

  return '';
}

function normalizeGame(event, league) {
  const competition = event.competitions?.[0] || {};
  const competitors = Array.isArray(competition.competitors)
    ? competition.competitors
    : [];

  const home = competitors.find(team => team.homeAway === 'home') || {};
  const away = competitors.find(team => team.homeAway === 'away') || {};

  const homeTeam = home.team || {};
  const awayTeam = away.team || {};

  const homeLogo = getLogo(homeTeam);
  const awayLogo = getLogo(awayTeam);

  const status = competition.status || event.status || {};
  const statusType = status.type || {};

  return {
    id: String(event.id || `${league.id}-${event.date || ''}`),

    league: {
      id: league.id,
      name: league.name
    },

    date: event.date || competition.date || '',

    home_team: {
      id: String(homeTeam.id || ''),
      name: homeTeam.displayName || homeTeam.name || 'Mandante',
      logo: homeLogo
    },

    away_team: {
      id: String(awayTeam.id || ''),
      name: awayTeam.displayName || awayTeam.name || 'Visitante',
      logo: awayLogo
    },

    home_logo: homeLogo,
    away_logo: awayLogo,

    scores: {
      home: home.score ?? null,
      away: away.score ?? null
    },

    status: {
      short: statusType.shortDetail || statusType.name || '',
      state: statusType.state || '',
      detail: statusType.detail || '',
      clock: status.displayClock || ''
    },

    source: 'ESPN'
  };
}

async function fetchLeagueGames(league, date) {
  const url =
    `https://site.api.espn.com/apis/site/v2/sports/soccer/${league.id}/scoreboard?dates=${date}`;

  try {
    const data = await requestJson(url);
    const events = Array.isArray(data.events) ? data.events : [];

    return events.map(event => normalizeGame(event, league));
  } catch (error) {
    console.error(
      `[FUTEBOL] ${league.name}: ${error.message}`
    );

    return [];
  }
}

async function loadFootballGames(date) {
  const cacheKey = `games:${date}`;
  const cached = footballCache.get(cacheKey);

  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.data;
  }

  const results = await Promise.all(
    FOOTBALL_LEAGUES.map(league => fetchLeagueGames(league, date))
  );

  const games = results.flat().sort((a, b) => {
    const dateA = Date.parse(a.date) || 0;
    const dateB = Date.parse(b.date) || 0;
    return dateA - dateB;
  });

  const data = {
    ok: true,
    date,
    source: 'ESPN',
    updatedAt: new Date().toISOString(),
    count: games.length,
    successfulSources: FOOTBALL_LEAGUES.length,
    totalSources: FOOTBALL_LEAGUES.length,
    games
  };

  footballCache.set(cacheKey, {
    time: Date.now(),
    data
  });

  return data;
}

/*
 * Arquivos estáticos do site.
 */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webmanifest': 'application/manifest+json'
};

function serveStatic(req, res, pathname) {
  let decoded;

  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return sendJson(res, 400, { ok: false, error: 'URL inválida.' });
  }

  if (decoded.includes('\0')) {
    return sendJson(res, 400, { ok: false, error: 'Caminho inválido.' });
  }

  const relativePath = decoded === '/'
    ? 'index.html'
    : decoded.replace(/^\/+/, '');

  const filePath = path.resolve(PUBLIC_DIR, relativePath);

  if (
    filePath !== PUBLIC_DIR &&
    !filePath.startsWith(PUBLIC_DIR + path.sep)
  ) {
    return sendJson(res, 403, { ok: false, error: 'Acesso negado.' });
  }

  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) {
      return sendJson(res, 404, {
        ok: false,
        error: 'Arquivo não encontrado.'
      });
    }

    const contentType =
      MIME_TYPES[path.extname(filePath).toLowerCase()] ||
      'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });

    const stream = fs.createReadStream(filePath);

    stream.on('error', () => {
      if (!res.headersSent) {
        sendJson(res, 500, {
          ok: false,
          error: 'Erro ao ler arquivo.'
        });
      } else {
        res.destroy();
      }
    });

    stream.pipe(res);
  });
}

/*
 * Rotas HTTP.
 */
const server = http.createServer(async (req, res) => {
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url, `http://${host}`);
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });

    return res.end();
  }

  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
    return sendJson(res, 405, {
      ok: false,
      error: 'Método não permitido.'
    });
  }

  if (pathname === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      service: 'vem-comigo-tv',
      status: 'online',
      time: new Date().toISOString()
    });
  }

  if (pathname === '/api/games/today') {
    const requestedDate = url.searchParams.get('date');
    const date = requestedDate || todaySaoPaulo();

    if (!/^\d{8}$/.test(date)) {
      return sendJson(res, 400, {
        ok: false,
        error: 'Data inválida. Use YYYYMMDD.'
      });
    }

    try {
      const data = await loadFootballGames(date);
      return sendJson(res, 200, data);
    } catch (error) {
      console.error('[FUTEBOL]', error);

      return sendJson(res, 502, {
        ok: false,
        error: 'Não foi possível consultar os jogos agora.',
        date,
        games: []
      });
    }
  }

  // Importar playlist M3U por URL
  if (req.method === 'POST' && pathname === '/api/import-playlist') {
    try {
      const body = await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => {
          data += chunk;
          if (data.length > 100000) {
            reject(new Error('Dados enviados muito grandes.'));
            req.destroy();
          }
        });
        req.on('end', () => {
          try {
            resolve(JSON.parse(data || '{}'));
          } catch {
            reject(new Error('JSON inválido.'));
          }
        });
        req.on('error', reject);
      });

      const playlistUrl = new URL(String(body.url || ''));
      if (
        !['http:', 'https:'].includes(playlistUrl.protocol) ||
        !playlistUrl.hostname ||
        /^(localhost|.*\.localhost|.*\.local)$/i.test(playlistUrl.hostname) ||
        /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(playlistUrl.hostname)
      ) {
        return sendJson(res, 400, {
          ok: false,
          error: 'URL inválida ou endereço não permitido.'
        });
      }

      const response = await fetch(playlistUrl, {
        signal: AbortSignal.timeout(20000),
        redirect: 'error'
      });

      if (!response.ok) {
        return sendJson(res, 502, {
          ok: false,
          error: `O servidor da playlist respondeu HTTP ${response.status}.`
        });
      }

      const playlist = await response.text();

      if (
        playlist.length > 15 * 1024 * 1024 ||
        !playlist.trim().startsWith('#EXTM3U')
      ) {
        return sendJson(res, 400, {
          ok: false,
          error: 'A URL não retornou uma playlist M3U válida ou o arquivo é muito grande.'
        });
      }

      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(playlist);
    } catch (error) {
      console.error('[IMPORT M3U]', error);
      return sendJson(res, 400, {
        ok: false,
        error: 'Falha ao importar a playlist. Verifique a URL e tente novamente.'
      });
    }
  }

  // Importar playlist Xtream Codes
  if (req.method === 'POST' && pathname === '/api/xtream') {
    try {
      const body = await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => {
          data += chunk;
          if (data.length > 100000) {
            reject(new Error('Dados enviados muito grandes.'));
            req.destroy();
          }
        });
        req.on('end', () => {
          try {
            resolve(JSON.parse(data || '{}'));
          } catch {
            reject(new Error('JSON inválido.'));
          }
        });
        req.on('error', reject);
      });

      const base = new URL(String(body.server || ''));
      if (
        !['http:', 'https:'].includes(base.protocol) ||
        !base.hostname ||
        /^(localhost|.*\.localhost|.*\.local)$/i.test(base.hostname) ||
        /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(base.hostname)
      ) {
        return sendJson(res, 400, {
          ok: false,
          error: 'Endereço do servidor inválido.'
        });
      }

      if (!body.username || !body.password) {
        return sendJson(res, 400, {
          ok: false,
          error: 'Informe usuário e senha.'
        });
      }

      const playlistUrl = new URL(String(body.url || ''));

if (playlistUrl.protocol === 'https:') {
  playlistUrl.protocol = 'http:';
}

if (
  !['http:', 'https:'].includes(playlistUrl.protocol) ||
  !playlistUrl.hostname ||
  /^(localhost|.*\.localhost|.*\.local)$/i.test(playlistUrl.hostname) ||
  /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(playlistUrl.hostname)
) {
  return sendJson(res, 400, {
    ok: false,
    error: 'URL inválida ou endereço não permitido.'
  });
}

const response = await fetch(playlistUrl, {
  signal: AbortSignal.timeout(60000),
  redirect: 'follow'
});(playlistUrl, {
  signal: AbortSignal.timeout(20000),
  redirect: 'follow'
});

      if (!response.ok) {
        return sendJson(res, 502, {
          ok: false,
          error: `O servidor Xtream respondeu HTTP ${response.status}.`
        });
      }

      const playlist = await response.text();

      if (
        playlist.length > 15 * 1024 * 1024 ||
        !playlist.trim().startsWith('#EXTM3U')
      ) {
        return sendJson(res, 400, {
          ok: false,
          error: 'O servidor não retornou uma playlist M3U válida.'
        });
      }

      return sendJson(res, 200, {
        ok: true,
        playlist
      });
    } catch (error) {
      console.error('[XTREAM]', error);
      return sendJson(res, 400, {
        ok: false,
        error: 'Falha na conexão Xtream. Confira o endereço, usuário e senha.'
      });
    }
  }

  if (pathname === '/favicon.ico' && !fs.existsSync(
    path.join(PUBLIC_DIR, 'favicon.ico')
  )) {
    res.writeHead(204);
    return res.end();
  }

  return serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, () => {
  console.log('====================================');
  console.log(' VEM COMIGO TV');
  console.log(` Servidor online na porta ${PORT}`);
  console.log(' Futebol: /api/games/today');
  console.log(' Saúde: /api/health');
  console.log('====================================');
});

server.on('error', error => {
  console.error('[SERVIDOR]', error);
  process.exitCode = 1;
});
