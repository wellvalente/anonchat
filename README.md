# Chat Anônimo

Chat anônimo, sem cadastro, que roda direto no GitHub Pages. A pessoa escolhe um apelido e entra num chat com um código de 5 dígitos (ou cria um novo). Dá para mandar texto e fotos, e apagar as próprias mensagens.

Não existe servidor: os navegadores se conectam diretamente entre si (P2P via WebRTC), usando a biblioteca [Trystero](https://github.com/dmotz/trystero) com relays públicos da rede Nostr apenas para se encontrarem. As mensagens e fotos vão de um navegador para o outro, criptografadas.

## Publicar no GitHub Pages

1. Crie um repositório novo no GitHub (pode ser público).
2. Envie estes arquivos para a branch `main`:
   ```bash
   git remote add origin https://github.com/SEU-USUARIO/SEU-REPO.git
   git push -u origin main
   ```
3. No repositório, vá em **Settings → Pages**.
4. Em **Build and deployment**, escolha **Source: Deploy from a branch**, branch **main** e pasta **/ (root)**. Salve.
5. Em 1 ou 2 minutos o site fica disponível em `https://SEU-USUARIO.github.io/SEU-REPO/`.

## Testar no computador

O site precisa ser aberto por um servidor (abrir o `index.html` direto com duplo clique não funciona). Com Node.js instalado:

```bash
npx http-server . -p 8080
```

Depois abra `http://localhost:8080`. Para simular duas pessoas no mesmo computador, use uma aba em `http://localhost:8080` e outra em `http://127.0.0.1:8080`.

## Como funciona

- **Criar chat:** gera um código aleatório de 5 dígitos. O botão "copiar link" copia um link que já abre com o código preenchido.
- **Entrar:** qualquer pessoa com o código entra. Quem chega recebe o histórico de quem já está no chat.
- **Fotos:** são reduzidas no navegador (máx. 1280 px, até 2 MB) antes do envio. GIFs são enviados como estão.
- **Apagar:** cada mensagem carrega uma "trava" secreta que só o autor tem, então só quem enviou consegue apagar, para todos.

## Limitações do MVP

- **O histórico só existe enquanto alguém estiver no chat.** Se todos saírem, as mensagens somem.
- **Algumas redes bloqueiam conexões P2P** (redes corporativas restritas e algumas operadoras de celular). Nesses casos a pessoa entra mas não vê os outros. A solução é configurar um servidor TURN (ex.: Cloudflare, plano gratuito) na opção `turnConfig` do `joinRoom` em `app.js`.
- **Não dá para saber se um código já existe.** Entrar num código que ninguém usa abre um chat vazio.
- Indicado para grupos pequenos (até umas 10 pessoas por chat), porque cada navegador se conecta com todos os outros.
