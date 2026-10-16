const http=require('http'),fs=require('fs'),path=require('path');
const root=__dirname;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};
const allowedHost=process.env.M3U_ALLOWED_HOST||'195.181.163.138';
http.createServer(async(req,res)=>{
 const pathname=(req.url||'/').split('?')[0];
 if(pathname==='/api/xtream'){
  if(req.method!=='POST'){res.writeHead(405);return res.end();}
  let raw='';req.on('data',c=>{raw+=c;if(raw.length>8192)req.destroy();});
  req.on('end',async()=>{try{
   const {server,username,password,format}=JSON.parse(raw);
   if(!username||!password||username.length>160||password.length>160||!['ts','m3u8'].includes(format))throw Error('Dados inválidos');
   const u=new URL(server);const hosts=(process.env.XTREAM_ALLOWED_HOSTS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
   if(!hosts.length)throw Error('Configure XTREAM_ALLOWED_HOSTS no Render antes de conectar.');
   if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.pathname!=='/'||u.search||u.hash||!hosts.includes(u.hostname.toLowerCase()))throw Error('Servidor não autorizado nesta instalação.');
   const base=u.origin;const api=new URL('/player_api.php',base);api.searchParams.set('username',username);api.searchParams.set('password',password);
   const get=async(action)=>{const endpoint=new URL(api);if(action){const [act,id]=action.split('&series_id=');endpoint.searchParams.set('action',act);if(id)endpoint.searchParams.set('series_id',id);}const response=await fetch(endpoint,{redirect:'error',signal:AbortSignal.timeout(20000),headers:{'Accept':'application/json'}});if(!response.ok)throw Error('Servidor respondeu HTTP '+response.status);const maxBytes=48*1024*1024;let bytes=0;const chunks=[];for await(const chunk of response.body){bytes+=chunk.length;if(bytes>maxBytes)throw Error('Catálogo excede 48 MB; solicite ao provedor um catálogo reduzido.');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));};
   const auth=await get();if(!auth.user_info||String(auth.user_info.auth)!=='1')throw Error('Conta não autorizada pelo servidor');
   const live=await get('get_live_streams');const series=await get('get_series');const vods=await get('get_vod_streams');
   const lines=['#EXTM3U'];const safe=x=>String(x??'').replace(/[\r\n"<>]/g,' ').slice(0,220);
   const add=(name,group,url,logo)=>{lines.push(`#EXTINF:-1 tvg-logo="${safe(logo)}" group-title="${safe(group)}",${safe(name)}`);lines.push(url);};
   const authpath=`${encodeURIComponent(username)}/${encodeURIComponent(password)}`;
   for(const x of Array.isArray(live)?live.slice(0,5000):[]){if(!/^\d+$/.test(String(x.stream_id)))continue;add(x.name,x.category_name||'TV ao vivo',`${base}/live/${authpath}/${x.stream_id}.${format}`,x.stream_icon);}
   for(const x of Array.isArray(vods)?vods.slice(0,3000):[]){if(!/^\d+$/.test(String(x.stream_id)))continue;const ext=/^[a-z0-9]{2,5}$/i.test(x.container_extension||'')?x.container_extension:'mp4';add(x.name,x.category_name||'Filmes',`${base}/movie/${authpath}/${x.stream_id}.${ext}`,x.stream_icon);}
   // Series require episode lookup. Limit to avoid overwhelming provider.
   for(const x of (Array.isArray(series)?series:[]).slice(0,30)){if(!/^\d+$/.test(String(x.series_id)))continue;let details;try{details=await get('get_series_info&series_id='+x.series_id);}catch{continue;}
    const seasons=details.episodes||{};for(const [season,eps] of Object.entries(seasons)){for(const ep of Array.isArray(eps)?eps:[]){if(!/^\d+$/.test(String(ep.id)))continue;const ext=/^[a-z0-9]{2,5}$/i.test(ep.container_extension||'')?ep.container_extension:'mp4';add(`${x.name} S${season} E${ep.episode_num||'?'}`,x.category_name||'Séries Turcas',`${base}/series/${authpath}/${ep.id}.${ext}`,x.cover);}}
   }
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({playlist:lines.join('\n')}));
  }catch(e){res.writeHead(400,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:e.message}));}});return;
 }
 if(pathname==='/api/import-playlist'){
  if(req.method!=='POST'){res.writeHead(405);return res.end();}
  let body='';req.on('data',chunk=>{body+=chunk;if(body.length>8192)req.destroy();});
  req.on('end',async()=>{
   try{
    const input=JSON.parse(body);const u=new URL(input.url);
    if(!['http:','https:'].includes(u.protocol)||u.hostname!==allowedHost||u.port&&u.port!=='80'&&u.port!=='443'||u.pathname!=='/get.php')throw Error('URL não permitida. Use a URL M3U do fornecedor configurado.');
    if(!u.searchParams.get('username')||!u.searchParams.get('password'))throw Error('URL M3U incompleta.');
    const upstream=await fetch(u,{redirect:'error',signal:AbortSignal.timeout(90000),headers:{'User-Agent':'VemComigoTV/1.2','Accept':'*/*'}});
    if(!upstream.ok)throw Error('Servidor da playlist respondeu HTTP '+upstream.status);
    const max=120*1024*1024;let length=0;const chunks=[];
    for await(const chunk of upstream.body){length+=chunk.length;if(length>max)throw Error('Playlist muito grande.');chunks.push(chunk);}
    const data=Buffer.concat(chunks);if(!data.toString('utf8',0,Math.min(data.length,2048)).includes('#EXTM3U'))throw Error('O endereço não retornou uma playlist M3U.');
    res.writeHead(200,{'Content-Type':'audio/x-mpegurl; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data);
   }catch(e){res.writeHead(400,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:e.message||'Falha ao importar'}));}
  });return;
 }
 let p;try{p=decodeURIComponent(pathname);}catch{res.writeHead(400);return res.end();}
 const dest=path.resolve(root,'.'+(p==='/'?'/index.html':p));if(!dest.startsWith(root+path.sep)||!fs.existsSync(dest)||!fs.statSync(dest).isFile()){res.writeHead(404);return res.end('Não encontrado');}
 res.writeHead(200,{'Content-Type':types[path.extname(dest)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});fs.createReadStream(dest).pipe(res);
}).listen(process.env.PORT||10000,'0.0.0.0',()=>console.log('Vem Comigo TV online'));
