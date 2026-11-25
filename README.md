# Escala IEAD

Aplicativo responsivo para organizar as escalas do departamento de Multimídia. A equipe pode consultar o calendário no celular ou computador; líderes e administradores montam, revisam e publicam a escala do mês.

## Rodar localmente
  
Requer Node.js 20.18 ou mais recente.

1. No Windows, abra `iniciar-app.bat`; ou execute `npm install` e `npm start` nesta pasta.
2. Acesse [http://127.0.0.1:4173](http://127.0.0.1:4173).

O app cria `data/store.json` na primeira execução. Esse arquivo é local e ignorado pelo Git para não enviar dados pessoais ao repositório.

### Contas locais de demonstração

| Login | Senha | Perfil |
|---|---|---|
| `admin` | `admin` | TI: administra acessos e escalas |
| `user` | `user` | Membro: vê a escala publicada de Multimídia |
| `lider` | `lider123` | Líder: revisa e publica escalas |

Há também membros fictícios para Fotos, Live, Projetor e outro departamento. As senhas dos perfis de exemplo existem só para demonstração local; não use em um servidor público.

## Como funciona

- Cada evento tem uma pessoa em Fotos, uma em Live e uma em Projetor. Fotos é uma equipe separada; Live e Projetor podem ser escolhidos juntos no cadastro.
- Uma pessoa não pode ocupar duas funções no mesmo dia. A verificação acontece no servidor, mesmo se duas pessoas editarem ao mesmo tempo.
- A escala tem visualização em calendário e lista. A sugestão distribui os serviços por igual e considera as indisponibilidades informadas.
- Ao remover alguém de uma vaga, o app chama a próxima pessoa habilitada e redistribui as datas seguintes, respeitando os conflitos do mesmo dia.
- Toque no número de um dia do calendário para abrir os eventos, horários e funções. Gestores também podem trocar os nomes nessa janela.
- A página de entrada alterna versículos sobre serviço e dedicação a cada hora.
- O gestor revisa os nomes e publica a escala mensal. Membros só veem a escala publicada do próprio departamento.
- A pessoa pode avisar no app que não estará disponível; o gestor recebe o aviso e ajusta a escala.
- O botão **Testar conflito** tenta uma atribuição que deve ser bloqueada e abre o alerta de demonstração. O alerta repete a cada minuto até a escala ser ajustada; se outro gestor resolver, o app detecta a mudança na próxima verificação.
- Cultos de domingo podem ser cadastrados em lote. Novos eventos começam às 18h30, e o horário pode ser alterado.
- Os lembretes de segunda e sexta aparecem no app. Notificações do navegador dependem de permissão e o app precisa estar aberto nesses dias.

## Dados e publicação no Vercel

O armazenamento em arquivo serve para demonstração local. Em Vercel, o app usa PostgreSQL persistente pelo driver serverless da Neon. Crie um banco PostgreSQL pela integração do Marketplace e cadastre as variáveis abaixo em **Project Settings → Environment Variables**:

| Variável | Uso |
|---|---|
| `DATABASE_URL` | URL de conexão PostgreSQL da Neon |
| `SESSION_SECRET` | Segredo aleatório forte para assinar sessões |
| `INITIAL_ADMIN_PASSWORD` | Senha exclusiva para a primeira conta de TI |

Use valores secretos únicos. A conta inicial de produção é `admin`, mas a senha vem de `INITIAL_ADMIN_PASSWORD`; as contas `admin/admin` e `user/user` existem só na instalação local. Na primeira requisição, o app cria a tabela e o usuário de TI. As novas inscrições sempre entram como membros. O `vercel.json` separa a página e os arquivos estáticos da função Node que atende a API.

Depois de criar o repositório no GitHub:

```bash
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/Contagiovaneines/Escala-iead.git
git push -u origin main
```

Depois importe o repositório no Vercel, configure as três variáveis acima e faça o deploy. Não envie `.env`, `data/store.json` ou senhas reais para o GitHub.

## Verificação local

```bash
npm run check
npm test
```
