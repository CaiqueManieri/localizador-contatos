# Localizador de Contato

Ferramenta para **recuperar um número de celular que você perdeu**, a partir dos dígitos de que você ainda se lembra.

Você informa o DDD (ou a cidade) e os dígitos conhecidos. O app gera todas as combinações possíveis de celular brasileiro que se encaixam nesse padrão e ajuda a conferir uma por uma.

## Privacidade

- **Tudo roda no seu navegador.** O app é feito só de HTML, CSS e JavaScript, sem servidor. Nenhum dado digitado, gerado ou importado é enviado para lugar nenhum.
- **Não existe cadastro de pessoas.** Os números são combinações matemáticas. O app não sabe e não consulta a quem pertence cada número.
- As marcações de "visto" e a base da Anatel importada ficam salvas apenas no navegador de quem usa e podem ser apagadas a qualquer momento.

## Funcionalidades

- Busca por cidade com preenchimento automático do DDD, ou escolha de vários DDDs e estados inteiros.
- Filtros: faixa de celular (91 a 99 ou só 96 a 99), "começa com", dígitos que aparecem ou não aparecem e números repetidos.
- Importação opcional da tabela pública de faixas da Anatel, que descarta números de faixas nunca distribuídas e mostra a operadora de origem de cada número.
- Lista com caixa para marcar os números já conferidos e link para abrir a conversa no WhatsApp, sem ligar e sem salvar o contato.
- Exportação para Excel formatado, com coluna de status (Verificado / Não verificado), ou para CSV.
- Guia "Como funciona" dentro do app, explicando o número de celular brasileiro e cada campo.

## Como usar

1. Abra o `index.html` no navegador. Não precisa instalar nada.
2. Digite o DDD ou a cidade e preencha os dígitos que você lembra.
3. Opcional: em **Base oficial da Anatel**, importe o arquivo SMP do [portal nSAPN (Anatel / ABR Telecom)](https://easi.abrtelecom.com.br/nsapn/#/public/files) para eliminar números que não existem.
4. Clique em **Gerar lista** e confira os números, marcando os que já viu.

Para publicar online, basta servir os arquivos estáticos, por exemplo com o GitHub Pages.

## Uso aceitável

Esta ferramenta foi feita para ajudar a **recuperar contatos pessoais perdidos**. Ao usá-la, você concorda em **não** utilizá-la para:

- enviar spam, mensagens em massa ou telemarketing não solicitado;
- assediar, perseguir ou contatar quem não quer ser contatado;
- aplicar golpes ou qualquer tipo de fraude;
- montar bases de dados de pessoas ou violar a LGPD (Lei 13.709/2018);
- automatizar consultas ou envios no WhatsApp ou em outros serviços, contrariando os termos de uso deles.

Quem usa é o único responsável pela forma como usa os números gerados. Abrir muitas conversas seguidas no WhatsApp pode ser interpretado como atividade automatizada e levar ao bloqueio da sua conta: confira com calma.

## Arquivos

| Arquivo | Conteúdo |
| --- | --- |
| `index.html` | Página e guia "Como funciona" |
| `styles.css` | Visual |
| `app.js` | Formulário, geração da lista, marcações e exportação |
| `anatel.js` | Leitura e consulta da base de faixas da Anatel |
| `excel.js` | Geração da planilha `.xlsx` |
| `municipios.js` | Municípios brasileiros com UF e DDD |

## Licença

Distribuído sob a licença [MIT](LICENSE), sem garantias de qualquer tipo.
