# TieFinance - Kit de identidade e login animado

Base: primeira proposta aprovada (monograma T dourado e wordmark sans-serif). O símbolo foi reconstruído em SVG com três grupos de peças e gradientes; o lettering foi vetorizado a partir da imagem de referência. Não é o arquivo vetorial original de uma fonte de marca. A referência recortada está incluída para comparação. As curvas e os efeitos metálicos são aproximações.

## Arquivos
- `assets/logo-claro.svg` e `.png`: logo horizontal, lettering azul, fundo transparente; para fundos claros.
- `assets/logo-escuro.svg` e `.png`: logo horizontal, lettering branco, fundo transparente; para fundos escuros.
- `assets/simbolo.svg` e `.png`: monograma dourado isolado.
- `assets/wordmark-azul.svg` e `wordmark-branco.svg` e PNG correspondentes: nome isolado.
- `assets/icone-app.svg` e `.png`: ícone com fundo azul, 512 px no PNG.
- `assets/favicon.ico`: tamanhos 16, 32, 48 e 64 px.
- `assets/simbolo-monocromatico.svg`: alternativa azul sólida para impressão.
- `assets/simbolo-animado.svg`: animação independente, sem JS externo; testar suporte de SVG animado no navegador alvo.
- `componente-simbolo.html`: SVG inline com CSS de movimento, recomendado para integração direta.
- `animacao.css`: CSS separado (opcional se usar componente inline, que já inclui CSS).
- `login.html`: demonstração responsiva, com botão para repetir movimento e formulário sem envio de credenciais.

## Integração
Abra `login.html` depois de extrair a pasta inteira. Para integrar ao sistema, copie `assets/` para a pasta estática e insira o conteúdo de `componente-simbolo.html` no painel da marca. Em React, adapte os atributos SVG para JSX e mova o CSS para o stylesheet; se houver múltiplas instâncias inline, use IDs de gradiente exclusivos. Alternativamente, use `<img src="/assets/simbolo-animado.svg" alt="TieFinance">` e confira a animação no navegador alvo. A área do SVG animado tem margem para o deslocamento das partes.

## Movimento
A haste sobe (120 ms de atraso), a asa esquerda entra lateralmente (280 ms), a dobra direita vem em diagonal (470 ms); cada transição dura 850 ms. O nome e a assinatura entram a partir de 1050 ms, e o conjunto termina aproximadamente em 1700 ms. Não há loop automático. `prefers-reduced-motion: reduce` mostra a marca estática.

## Diretrizes
Azul #08245D, hover #0E3B8A, ouro #D4AF37, destaque #F4D068, escuro #7D6210, fundo #F5F7FB. Interface usa Plus Jakarta Sans se instalada/disponível, com fallback; a fonte não é distribuída no kit. O wordmark SVG usa contornos, sem dependência de fonte. A assinatura do logo completo usa uma fonte de sistema.

## Limites
Prévia do front-end, sem autenticação real, recuperação de senha ou conexão ao ERP. Não inserir dados reais. A assinatura em inglês segue a primeira proposta; a menção discreta à holding e a composição da tela são sugestões. Não houve verificação de registro de marca. Testes no Chromium: desktop, mobile, repetição, visibilidade de senha, formulário demonstrativo e preferência de movimento reduzido. Outros navegadores ainda não homologados.
