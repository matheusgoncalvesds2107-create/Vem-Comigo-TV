'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const state = {entries:[],tab:'home',query:'',region:'all',visible:48,filtered:[],playing:-1, engine:null, favorites:new Set(), seriesView:null};
const TABNAMES={home:'Explore a sua TV',aberta:'TV Aberta',filmes:'Filmes e HBO',esportes:'Esportes ao vivo',streaming:'Streaming',turcas:'Séries Turcas',favoritos:'Meus favoritos'};
const DB='vem-comigo-tv-local';
function dbOpen(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('storage');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function getSaved(k){const db=await dbOpen();return new Promise((resolve,reject)=>{const r=db.transaction('storage').objectStore('storage').get(k);r.onsuccess=()=>{resolve(r.result);db.close()};r.onerror=()=>{reject(r.error);db.close()};});}
async function setSaved(k,v){const db=await dbOpen();return new Promise((resolve,reject)=>{const tx=db.transaction('storage','readwrite');tx.objectStore('storage').put(v,k);tx.oncomplete=()=>{resolve();db.close()};tx.onerror=()=>{reject(tx.error);db.close()};});}
async function removeSaved(k){const db=await dbOpen();return new Promise((resolve,reject)=>{const tx=db.transaction('storage','readwrite');tx.objectStore('storage').delete(k);tx.oncomplete=()=>{resolve();db.close()};tx.onerror=()=>{reject(tx.error);db.close()};});}
function toast(s){const el=$('#toast');el.textContent=s;el.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>el.style.display='none',3500);}
function parseM3U(text){const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/),out=[];let meta=null;for(const raw of lines){const line=raw.trim();if(line.startsWith('#EXTINF:')){const attrs={};for(const m of line.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[m[1]]=m[2];const name=line.slice(line.lastIndexOf(',')+1).trim()||attrs['tvg-name']||'Sem nome';meta={name,group:attrs['group-title']||'Outros',logo:attrs['tvg-logo']||'',type:''};}else if(meta && line && !line.startsWith('#')){if(/^https?:\/\//i.test(line)){meta.url=line;meta.type=category(meta.group);meta.id=out.length;out.push(meta);}meta=null;}}return out;}
function category(group){const x=group.toLowerCase();if(x.includes('aberta'))return 'aberta';if(x.includes('esporte'))return 'esportes';if(x.includes('turca'))return 'turcas';if(x.includes('stream'))return 'streaming';if(x.includes('filme'))return 'filmes';return 'outros';}
function safeImg(url){try{const u=new URL(url);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;}}
function tab(t){state.seriesView=null;state.tab=t;state.visible=48;state.region='all';$('#regionSelect').value='all';$('#regionSelect').hidden=t!=='aberta';$('#sectionTitle').textContent=TABNAMES[t]||t;$('#hero').hidden=t!=='home';$$('[data-tab]').forEach(x=>x.classList.toggle('active',x.dataset.tab===t));render();window.scrollTo({top:0,behavior:'instant'});}
function render(){if(state.tab==='turcas'){renderSeries();return;}$('#seriesNav').hidden=true;const q=state.query.toLocaleLowerCase('pt-BR');state.filtered=state.entries.filter(e=>(state.tab==='home'||state.tab===e.type||(state.tab==='favoritos'&&state.favorites.has(e.url)))&&(state.region==='all'||(e.group+' '+e.name).toLowerCase().includes(state.region.toLowerCase()))&&(!q||(e.name+' '+e.group).toLocaleLowerCase('pt-BR').includes(q)));$('#sectionCount').textContent=state.filtered.length.toLocaleString('pt-BR')+' opções';$('#empty').hidden=!!state.entries.length;$('#grid').replaceChildren();const fragment=document.createDocumentFragment();for(const e of state.filtered.slice(0,state.visible)){const tile=document.createElement('article');tile.className='tile';const thumb=document.createElement('button');thumb.className='thumb';thumb.type='button';thumb.setAttribute('aria-label','Reproduzir '+e.name);thumb.onclick=()=>play(e);if(safeImg(e.logo)){const img=document.createElement('img');img.src=safeImg(e.logo);img.alt='';img.loading='lazy';img.onerror=()=>{img.remove();thumb.insertAdjacentHTML('beforeend','<span class="fallback">▶</span>')};thumb.append(img);}else{const s=document.createElement('span');s.className='fallback';s.textContent='▶';thumb.append(s);}const tag=document.createElement('span');tag.className='tag';tag.textContent=e.type==='turcas'?'EPISÓDIO':e.type==='filmes'?'FILME':'AO VIVO';thumb.append(tag);const bottom=document.createElement('div');bottom.className='tilebottom';const txt=document.createElement('div');txt.className='tiletext';const strong=document.createElement('strong');strong.textContent=e.name;strong.title=e.name;const small=document.createElement('small');small.textContent=e.group;txt.append(strong,small);const fav=document.createElement('button');fav.className='fave'+(state.favorites.has(e.url)?' on':'');fav.textContent=state.favorites.has(e.url)?'♥':'♡';fav.setAttribute('aria-label','Adicionar ou remover favorito');fav.onclick=async()=>{if(state.favorites.has(e.url))state.favorites.delete(e.url);else state.favorites.add(e.url);await setSaved('faves',[...state.favorites]);render();};bottom.append(txt,fav);tile.append(thumb,bottom);fragment.append(tile);}$('#grid').append(fragment);$('#more').hidden=state.visible>=state.filtered.length;}

function seriesMeta(e){
 const raw=e.name.trim();
 const m=raw.match(/^(.*?)\s*[-–:]?\s*(?:T(?:emporada)?\s*)?(?:S(?:eason)?\s*0*(\d+))\s*[-. ]*\s*(?:E(?:p(?:is[oó]dio)?)?\s*0*(\d+))\b/i)
   ||raw.match(/^(.*?)\s*[-–:]?\s*(\d{1,2})\s*[xX]\s*(\d{1,4})\b/);
 if(m)return {name:m[1].trim().replace(/[-–:]\s*$/,'').trim()||raw,season:Number(m[2]),episode:Number(m[3])};
 return {name:raw,season:1,episode:0};
}
function seriesCatalog(){
 const map=new Map();
 for(const e of state.entries){if(e.type!=='turcas')continue;
 const meta=seriesMeta(e),key=meta.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g,' ').trim();
 let series=map.get(key);if(!series){series={key,name:meta.name,logo:e.logo,seasons:new Map(),count:0};map.set(key,series);}
 let season=series.seasons.get(meta.season);if(!season){season=[];series.seasons.set(meta.season,season);}
 season.push({...e,episodeNumber:meta.episode,seasonNumber:meta.season});series.count++;
 }
 return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR',{sensitivity:'base'}));
}
function makeSeriesCard(name,sub,logo,tag,onclick){
 const tile=document.createElement('article');tile.className='tile series-tile';
 const thumb=document.createElement('button');thumb.type='button';thumb.className='thumb';thumb.setAttribute('aria-label','Abrir '+name);thumb.onclick=onclick;
 if(safeImg(logo)){const img=document.createElement('img');img.src=safeImg(logo);img.loading='lazy';img.alt='';img.onerror=()=>{img.remove();const fallback=document.createElement('span');fallback.className='fallback';fallback.textContent='▶';thumb.append(fallback);};thumb.append(img);}else{const fallback=document.createElement('span');fallback.className='fallback';fallback.textContent='▶';thumb.append(fallback);}
 const label=document.createElement('span');label.className='tag';label.textContent=tag;thumb.append(label);
 const bottom=document.createElement('button');bottom.type='button';bottom.className='series-bottom';bottom.onclick=onclick;
 const strong=document.createElement('strong');strong.textContent=name;
 const small=document.createElement('small');small.textContent=sub;
 bottom.append(strong,small);tile.append(thumb,bottom);return tile;
}
function renderSeries(){
 const catalog=seriesCatalog(),q=state.query.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
 const nav=$('#seriesNav'),grid=$('#grid');nav.hidden=false;grid.replaceChildren();
 $('#empty').hidden=!!state.entries.length;
 const view=state.seriesView;
 if(!view){
  nav.replaceChildren();$('#sectionTitle').textContent='Séries Turcas';
  const matching=catalog.filter(v=>v.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').includes(q));
  $('#sectionCount').textContent=matching.length.toLocaleString('pt-BR')+' novelas • '+matching.reduce((n,v)=>n+v.count,0).toLocaleString('pt-BR')+' episódios';
  for(const series of matching.slice(0,state.visible))grid.append(makeSeriesCard(series.name,`${series.seasons.size} temporada(s) · ${series.count} episódios`,series.logo,'NOVELA',()=>{state.seriesView={key:series.key};state.visible=48;render();}));
  $('#more').hidden=matching.length<=state.visible;$('#more').onclick=()=>{state.visible+=48;render();};return;
 }
 const series=catalog.find(x=>x.key===view.key);if(!series){state.seriesView=null;render();return;}
 const back=document.createElement('button');back.type='button';back.className='series-back';back.textContent=view.season===undefined?'← Todas as novelas':'← Temporadas';back.onclick=()=>{state.seriesView=view.season===undefined?null:{key:view.key};state.visible=48;render();};
 const path=document.createElement('span');path.textContent=view.season===undefined?series.name:`${series.name} / Temporada ${view.season}`;
 nav.replaceChildren(back,path);$('#sectionTitle').textContent=series.name;
 if(view.season===undefined){
  const seasons=[...series.seasons].sort((a,b)=>a[0]-b[0]);$('#sectionCount').textContent=`${seasons.length} temporada(s) · ${series.count} episódios`;
  for(const [number,episodes] of seasons)grid.append(makeSeriesCard(`Temporada ${number}`,`${episodes.length} episódios`,episodes[0]?.logo||series.logo,'TEMPORADA',()=>{state.seriesView={key:series.key,season:number};state.visible=48;render();}));
  $('#more').hidden=true;return;
 }
 const episodes=[...(series.seasons.get(view.season)||[])].sort((a,b)=>a.episodeNumber-b.episodeNumber||a.name.localeCompare(b.name,'pt-BR'));
 $('#sectionCount').textContent=`Temporada ${view.season} · ${episodes.length} episódios`;
 state.filtered=episodes;
 for(const e of episodes.slice(0,state.visible))grid.append(makeSeriesCard(e.episodeNumber?`Episódio ${e.episodeNumber}`:e.name,e.name,e.logo,'EPISÓDIO',()=>play(e)));
 $('#more').hidden=episodes.length<=state.visible;$('#more').onclick=()=>{state.visible+=48;render();};
}
function openModal(id){$('#'+id).showModal();}function stop(){const v=$('#video');v.pause();try{if(state.engine)state.engine.destroy();}catch{}state.engine=null;v.removeAttribute('src');v.load();}
function loadScript(src){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(Error('Não foi possível carregar a biblioteca do player.'));document.head.append(s);});}
let playbackAttempt=0;
function isVemComigoAndroidApp(){
  return /Android/i.test(navigator.userAgent) && /(?:;|\s)wv(?:\)|;|\s)/i.test(navigator.userAgent);
}
function openAndroidPlayer(e){
  try{
    const u=new URL(e.url);
    if(!['http:','https:'].includes(u.protocol))throw Error('Endereço de vídeo inválido.');
    window.location.href='vemcomigotv://play?url='+encodeURIComponent(u.href);
    return true;
  }catch(err){
    toast('Não foi possível abrir o player Android: '+err.message);
    return false;
  }
}
async function play(e){
  if(isVemComigoAndroidApp() && openAndroidPlayer(e))return;
 const attempt=++playbackAttempt;
 state.playing=state.filtered.indexOf(e);
 openModal('playerDialog');
 $('#playerTitle').textContent=e.name;
 $('#favPlayer').textContent=state.favorites.has(e.url)?'♥ Favorito':'♡ Favorito';
 const msg=$('#playerMsg');msg.textContent='Carregando transmissão...';
 stop();
 const v=$('#video'), url=e.url;
 const active=()=>attempt===playbackAttempt;
 const explain=(detail)=>{if(active())msg.textContent=detail;};
 const start=async()=>{
  if(!active())return;
  try{await v.play();if(active())msg.textContent='';}
  catch(err){explain(err?.name==='NotAllowedError'?'Toque no ▶ do vídeo para iniciar.':'Não foi possível iniciar: '+(err?.message||'verifique o sinal e a autorização.'));}
 };
 v.onerror=()=>{
  const errors={1:'Reprodução cancelada.',2:'Falha de rede ao carregar o vídeo.',3:'O navegador não conseguiu decodificar este vídeo.',4:'Formato de vídeo não suportado ou endereço bloqueado.'};
  explain(errors[v.error?.code]||'Erro desconhecido ao carregar o vídeo.');
 };
 v.onplaying=()=>{if(active())msg.textContent='';};
 try{
  if(/^http:\/\//i.test(url)&&location.protocol==='https:'){
   explain('O canal usa HTTP, mas o site usa HTTPS. O navegador pode bloquear o vídeo (conteúdo misto). Peça ao fornecedor um endereço HTTPS válido.');
   return;
  }
  const pathname=new URL(url).pathname.toLowerCase();
  if(pathname.endsWith('.m3u8')){
   if(v.canPlayType('application/vnd.apple.mpegurl')){v.src=url;v.addEventListener('loadedmetadata',start,{once:true});}
   else{
    if(!window.Hls)await loadScript('https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js');
    if(!window.Hls?.isSupported())throw Error('Este navegador não suporta HLS.');
    if(!active())return;
    const h=new window.Hls({enableWorker:true});state.engine=h;
    h.on(window.Hls.Events.MANIFEST_PARSED,()=>{if(active())start();});
    h.on(window.Hls.Events.ERROR,(_,data)=>{
     if(!active())return;
     if(data.fatal){
      const type=data.type||'erro';const detail=data.details||'desconhecido';
      explain(`Falha HLS (${type}: ${detail}). Pode ser CORS, autorização, rede ou formato de transmissão.`);
     }
    });
    h.attachMedia(v);h.loadSource(url);
   }
  }else if(pathname.endsWith('.ts')){
   if(!window.mpegts)await loadScript('https://cdn.jsdelivr.net/npm/mpegts.js@1/dist/mpegts.js');
   if(!window.mpegts?.isSupported())throw Error('MPEG-TS não suportado neste navegador.');
   if(!active())return;
   const player=window.mpegts.createPlayer({type:'mpegts',isLive:true,url},{enableWorker:false,lazyLoad:false});
   state.engine=player;player.attachMediaElement(v);
   player.on(window.mpegts.Events.ERROR,(type,detail)=>explain(`Falha MPEG-TS (${type||'erro'}: ${detail||'sem detalhes'}). Verifique o servidor e o formato.`));
   v.addEventListener('loadedmetadata',start,{once:true});player.load();
  }else{
   v.src=url;v.addEventListener('loadedmetadata',start,{once:true});
  }
 }catch(err){explain(err?.message||'Falha ao reproduzir o vídeo.');}
}

function next(step){if(!state.filtered.length)return;let idx=state.playing+step;if(idx<0)idx=state.filtered.length-1;if(idx>=state.filtered.length)idx=0;play(state.filtered[idx]);}
async function importFile(f){if(!f)return;$('#importStatus').textContent='Lendo e organizando os canais...';try{const txt=await f.text();if(!txt.includes('#EXTINF'))throw Error('O arquivo não parece ser uma playlist M3U válida.');const entries=parseM3U(txt);if(!entries.length)throw Error('Nenhum endereço de vídeo válido encontrado.');await setSaved('playlist',txt);state.entries=entries;$('#importStatus').textContent=`${entries.length.toLocaleString('pt-BR')} entradas importadas com sucesso.`;toast('Playlist importada!');tab('home');}catch(err){$('#importStatus').textContent='Erro: '+err.message;}}
$$('[data-close]').forEach(b=>b.onclick=()=>{$('#'+b.dataset.close).close();if(b.dataset.close==='playerDialog')stop();});$('#playerDialog').addEventListener('close',stop);$('#fileInput').onchange=e=>importFile(e.target.files[0]);$('#importUrlBtn').onclick=async()=>{const btn=$('#importUrlBtn');const url=$('#playlistUrl').value.trim();if(!url){$('#importStatus').textContent='Cole a URL M3U primeiro.';return;}btn.disabled=true;$('#importStatus').textContent='Baixando playlist pelo servidor, aguarde...';try{const resp=await fetch('/api/import-playlist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});if(!resp.ok){let msg='Erro HTTP '+resp.status;try{const d=await resp.json();msg=d.error||msg;}catch{}throw Error(msg);}const txt=await resp.text();if(!txt.includes('#EXTINF'))throw Error('O servidor não retornou uma playlist M3U válida.');const entries=parseM3U(txt);if(!entries.length)throw Error('Nenhum canal válido na lista.');await setSaved('playlist',txt);state.entries=entries;$('#importStatus').textContent=entries.length.toLocaleString('pt-BR')+' entradas importadas.';$('#playlistUrl').value='';toast('Playlist importada por URL!');tab('home');}catch(err){$('#importStatus').textContent='Erro: '+err.message;}finally{btn.disabled=false;}};$('#xtConnect').onclick=async()=>{const b=$('#xtConnect');b.disabled=true;$('#importStatus').textContent='Conectando ao servidor...';try{const r=await fetch('/api/xtream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({server:$('#xtServer').value.trim(),username:$('#xtUser').value.trim(),password:$('#xtPass').value,format:$('#xtFormat').value})});const d=await r.json();if(!r.ok)throw Error(d.error||'Erro na conexão');const txt=d.playlist;const entries=parseM3U(txt);if(!entries.length)throw Error('Servidor não retornou canais disponíveis.');await setSaved('playlist',txt);state.entries=entries;$('#xtPass').value='';$('#importStatus').textContent=entries.length+' entradas importadas.';toast('Xtream conectado!');tab('home');}catch(e){$('#importStatus').textContent='Erro: '+e.message;}finally{b.disabled=false;}};$('#importBtn').onclick=$('#heroImport').onclick=$('#emptyImport').onclick=()=>openModal('importDialog');$('#heroExplore').onclick=()=>tab('aberta');$$('[data-tab]').forEach(b=>b.onclick=()=>tab(b.dataset.tab));$('#search').oninput=e=>{state.query=e.target.value;state.visible=48;render();};$('#searchToggle').onclick=()=>{$('#search').focus();};$('#regionSelect').onchange=e=>{state.region=e.target.value;render();};$('#more').onclick=()=>{state.visible+=48;render();};$('#nextBtn').onclick=()=>next(1);$('#prevBtn').onclick=()=>next(-1);$('#favPlayer').onclick=async()=>{const e=state.filtered[state.playing];if(!e)return;if(state.favorites.has(e.url))state.favorites.delete(e.url);else state.favorites.add(e.url);await setSaved('faves',[...state.favorites]);$('#favPlayer').textContent=state.favorites.has(e.url)?'♥ Favorito':'♡ Favorito';render();};$('#deletePlaylist').onclick=async()=>{if(!confirm('Apagar a playlist salva neste dispositivo?'))return;await removeSaved('playlist');state.entries=[];$('#importStatus').textContent='Playlist apagada.';$('#importDialog').close();tab('home');};document.addEventListener('keydown',e=>{if($('#playerDialog').open){if(e.key==='ArrowRight')next(1);if(e.key==='ArrowLeft')next(-1);}});
(async()=>{try{state.favorites=new Set(await getSaved('faves')||[]);const txt=await getSaved('playlist');if(txt)state.entries=parseM3U(txt);}catch(err){toast('O navegador não liberou o armazenamento local.');}tab('home');})();
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
