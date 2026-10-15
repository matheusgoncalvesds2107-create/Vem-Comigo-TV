# Vem Comigo TV — PWA / Web

## Publicar no Render
1. Envie todos estes arquivos para um repositório GitHub (a pasta `icons` deve ser mantida).
2. Render → New → Web Service → conectar o repositório.
3. Runtime: Node; Build Command: `npm install`; Start Command: `npm start`.
4. Acesse o link HTTPS do Render, clique **+ Playlist** e selecione seu arquivo `.m3u`.
5. No Chrome Android, menu ⋮ → **Adicionar à tela inicial** ou **Instalar app**.

## Como funciona
- A playlist é lida no próprio aparelho e armazenada no IndexedDB do navegador. Não fica exposta no GitHub ou Render.
- Se importar em outro celular, precisa importar novamente.
- Há filtros por aba, região, busca, favoritos e navegação anterior/próximo.
- A grade não precisa carregar os 13 mil itens de uma vez: usa lotes de 48.
- O player usa reprodução nativa para MP4, hls.js para M3U8 e mpegts.js para MPEG-TS. As bibliotecas de vídeo carregam de CDN quando necessárias (é necessária conexão).
- Transmissões podem falhar por CORS, bloqueio do provedor, expiração ou incompatibilidade. O app não contorna proteções, logins, DRM nem autorizações de distribuição.
- O PWA funciona instalado; canais e vídeos precisam de rede e permissão de acesso à fonte.

Use apenas listas de fontes para as quais você tem direito de acesso e reprodução.
