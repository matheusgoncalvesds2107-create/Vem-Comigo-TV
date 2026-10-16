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
       // Limites evitam respostas enormes e processamento excessivo no plano Free.
    const get=async(action,categoryId)=>{
     const endpoint=new URL(api);
     if(action){endpoint.searchParams.set('action',action);}
     if(categoryId!==undefined)endpoint.searchParams.set('category_id',String(categoryId));
     const response=await fetch(endpoint,{redirect:'error',signal:AbortSignal.timeout(45000),headers:{Accept:'application/json'}});
     if(!response.ok)throw Error('Servidor respondeu HTTP '+response.status);
     const max=48*1024*1024;const size=Number(response.headers.get('content-length')||0);
     if(size>max)throw Error('Categoria muito grande; tente outra fonte ou uma lista M3U reduzida.');
     const parts=[];let total=0;
     for await(const chunk of response.body){total+=chunk.length;if(total>max)throw Error('Categoria muito grande; tente uma lista M3U reduzida.');parts.push(chunk);}
     try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw Error('Resposta inválida do servidor IPTV');}
    };
    const auth=await get();if(!auth.user_info||String(auth.user_info.auth)!=='1')throw Error('Conta não autorizada pelo servidor');
    const wanted=/(globo|rbs|sbt|record|band|rede.?tv|telecine|hbo|max|espn|sportv|spor.?tv|premiere|paramount|amazon|prime|turc|turk|novela)/i;
    const choices=[
      {kind:'live',categories:'get_live_categories',streams:'get_live_streams'},
      {kind:'vod',categories:'get_vod_categories',streams:'get_vod_streams'},
      {kind:'series',categories:'get_series_categories',streams:'get_series'}
    ];
    const lines=['#EXTM3U'];const safe=x=>String(x??'').replace(/[\r\n"<>]/g,' ').slice(0,220);
    const add=(name,group,url,logo)=>{lines.push(`#EXTINF:-1 tvg-logo="${safe(logo)}" group-title="${safe(group)}",${safe(name)}`);lines.push(url);};
    const authpath=`${encodeURIComponent(username)}/${encodeURIComponent(password)}`;
    const groupFor=(kind,name,cat)=>{
      const v=(name+' '+cat).toLowerCase();
      if(kind==='series')return 'Séries Turcas';
      if(kind==='vod')return 'Filmes';
      if(/espn|sportv|spor.?tv|premiere|esport|futebol/.test(v))return 'Esportes';
      if(/telecine|hbo/.test(v))return 'Filmes';
      if(/paramount|amazon|prime|max|stream/.test(v))return 'Streaming';
      return 'TV Aberta';
    };
    let count=0;const MAX_ENTRIES=6500;
    for(const choice of choices){
      let cats=[];try{const result=await get(choice.categories);if(Array.isArray(result))cats=result;}catch{}
      // A busca por categoria evita baixar as dezenas de milhares de títulos de uma vez.
      const selected=cats.filter(c=>wanted.test(c.category_name||'')).slice(0,12);
      const batches=selected.length?selected.map(c=>({id:c.category_id,name:c.category_name})):[{id:undefined,name:''}];
      for(const batch of batches){
        if(count>=MAX_ENTRIES)break;
        let items;try{items=await get(choice.streams,batch.id);}catch(e){if(!count&&batches.length===1)throw e;continue;}
        if(!Array.isArray(items))continue;
        let seriesFetched=0;
        for(const x of items){
          if(count>=MAX_ENTRIES)break;
          const name=String(x.name||x.title||'');const cat=String(batch.name||x.category_name||'');
          if(!wanted.test(name+' '+cat))continue;
          if(choice.kind==='live'){
            if(!/^\d+$/.test(String(x.stream_id)))continue;
            add(name,groupFor('live',name,cat),`${base}/live/${authpath}/${x.stream_id}.${format}`,x.stream_icon);count++;
          }else if(choice.kind==='vod'){
            if(!/^\d+$/.test(String(x.stream_id)))continue;
            const ext=/^[a-z0-9]{2,5}$/i.test(x.container_extension||'')?x.container_extension:'mp4';
            add(name,'Filmes',`${base}/movie/${authpath}/${x.stream_id}.${ext}`,x.stream_icon);count++;
          }else{
            if(seriesFetched>=35||!/^\d+$/.test(String(x.series_id)))continue;
            seriesFetched++;
            let details;try{
              const endpoint=new URL(api);endpoint.searchParams.set('action','get_series_info');endpoint.searchParams.set('series_id',String(x.series_id));
              const r=await fetch(endpoint,{redirect:'error',signal:AbortSignal.timeout(12000)});
              if(!r.ok)continue;
              const t=await r.text();if(t.length>1500000)continue;details=JSON.parse(t);
            }catch{continue;}
            for(const [season,eps] of Object.entries(details.episodes||{})){
              for(const ep of Array.isArray(eps)?eps:[]){
                if(count>=MAX_ENTRIES||!/^\d+$/.test(String(ep.id)))continue;
                const ext=/^[a-z0-9]{2,5}$/i.test(ep.container_extension||'')?ep.container_extension:'mp4';
                add(`${name} S${season} E${ep.episode_num||'0'}`,'Séries Turcas',`${base}/series/${authpath}/${ep.id}.${ext}`,x.cover);count++;
              }
            }
          }
        }
      }
    }
    if(!count)throw Error('Nenhum canal selecionado foi encontrado nas categorias disponíveis.');
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
