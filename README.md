# Visual Editor

Abre os arquivos de estilo do seu projeto — `.css`, `.json`, `.txt` — como uma **interface de
controles** em vez de código. Cores viram seletor de cor, medidas viram slider, sombras viram
camadas editáveis. Você mexe nos controles, o plugin grava no arquivo real dentro do cofre, e o
servidor de desenvolvimento recarrega sozinho.

> **A promessa central:** o plugin reescreve **apenas os caracteres do valor** que você editou. O
> que ele não entendeu não vira controle, e o que não vira controle nunca é reescrito. Media
> queries, `@keyframes`, seletores, comentários e formatação sobrevivem byte a byte.

---

## Para que serve

Se você mantém o CSS de um projeto dentro do cofre do Obsidian, abrir aquele arquivo mostra um
paredão de código mesmo quando tudo o que você quer é clarear uma cor ou aumentar um espaçamento.

Este plugin troca o paredão por controles:

| No arquivo | Na tela |
|---|---|
| `--cor-primaria: #e63946;` | um seletor de cor |
| `--espaco-md: 16px;` | um slider com o número ao lado |
| `--fonte-titulo: 'Poppins', sans-serif;` | um campo com prévia na própria fonte |
| `--sombra: 0 2px 8px rgba(0,0,0,.1);` | camadas com cor, opacidade, X, Y, desfoque |
| `padding: 8px 16px;` | quatro campos (cima, direita, baixo, esquerda) |
| `--animacao-ativa: true;` | um interruptor |

---

## Instalação

Pelo [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Instale o BRAT pelos plugins da comunidade.
2. Em **BRAT → Add Beta Plugin**, cole `ferdicez/obsidian-visual-editor`.
3. Ative o **Visual Editor** na lista de plugins.

---

## Como usar

### Achar os arquivos

Clique no ícone **de barrinhas** (`sliders-horizontal`) na barra lateral esquerda. Ele abre um
explorador que mostra **só as pastas que contêm arquivos editáveis** — uma pasta com 200 notas e
nenhum CSS não aparece.

Clicar num arquivo ali já o abre na interface de controles.

> Também dá para abrir pelo menu `...` da aba de um arquivo já aberto, ou pelo comando
> **"Alternar entre editor visual e código"**.

### As duas abas

Um arquivo CSS tem dois assuntos diferentes, e cada um tem sua aba:

**Tokens** — as variáveis (`--cor-primaria: #e63946`). São os valores que se repetem pelo projeto.
Mudar um aqui muda em todo lugar que o usa.

**Elementos** — as regras (`.card { padding: 16px }`). Mostram o que cada parte da página usa.

O botão de **duas colunas** na barra mostra as duas listas lado a lado.

### Editar um token

Cada linha é uma variável. O controle depende do valor: cor abre um seletor, medida tem slider e
campo numérico, e assim por diante.

O **(i)** ao lado do nome aparece quando há algo a explicar — o comentário que você escreveu no CSS
acima da variável, ou a lista de onde ela é usada. É o que distingue um `--spacing-3` de um
`--spacing-4` quando o nome não diz nada.

### Editar um elemento

Na aba **Elementos**, cada linha é uma propriedade de uma regra.

- Quando o valor **já usa uma variável**, aparece a ficha dela (com a cor, quando for cor). Clicar
  abre uma janelinha para editar o token ali mesmo, sem sair da lista.
- Quando o valor é **literal** (`background: white`), o botão de **corrente** oferece trocar por uma
  variável existente ou **extrair para uma variável nova**.

O **(i)** no cabeçalho de cada grupo explica **o que aquela regra é** e **quando ela vale**. O
"quando" é deduzido do seletor: `@media (width >= 48rem)` vira "a tela tem 768px ou mais",
`:focus-visible` vira "o elemento está em foco pelo teclado".

O "o que é" vem de você: o **comentário escrito na linha logo acima da regra** vira a descrição, sem
linha em branco entre os dois.

```css
/* A citação: um traço na lateral e o texto um tom mais claro. */
.artigo blockquote { … }
```

Um seletor diz o que a regra *alcança*, nunca o que ela *é* — e a maioria não tem condição nenhuma
para traduzir. A frase é o que faz `.artigo blockquote` se explicar numa lista de dezenas de regras.

### Extrair para variável

Vendo `padding: 24px` numa regra, o botão de corrente → **"Extrair para uma variável nova…"** cria
`--card-padding: 24px` no bloco de tokens e troca o uso por `var(--card-padding)`.

O bloco de tokens é o **`:root`** de topo — ou o **`@theme`**, em projetos Tailwind v4, onde é ali que
os tokens moram e é o que gera as classes utilitárias. O aviso diz onde a variável foi criada.

⚠️ **Esta é a única operação do plugin que acrescenta linha ao arquivo.** Ela recusa quando:

- não há um bloco `:root` nem `@theme` de topo para receber a declaração (o plugin não escolhe um
  lugar sozinho);
- o bloco está dentro de uma `@media` (o token ficaria indefinido fora daquela largura);
- o nome já existe;
- a regra vem antes do bloco de tokens no arquivo.

### Organizar a lista

**Agrupamento** (o ícone de grupo na barra) — três modos para os tokens:

| Modo | Agrupa por |
|---|---|
| Por seção do arquivo | comentários como `/* === Cores === */` que você escreve no CSS |
| Por prefixo do nome | `--color-linha` e `--color-texto` juntos |
| Por seletor CSS | o bloco onde a variável foi declarada |

Se um modo não se aplica ao arquivo (um CSS sem nenhum comentário de seção), ele cai para o próximo
sozinho, e a opção aparece apagada no menu.

**Acordeão** — cada grupo abre e fecha. A contagem à direita mostra o tamanho antes de abrir, e
durante uma busca tudo abre sozinho.

**Busca** — o campo no topo filtra por nome, valor, grupo, ou pelo nome de uma variável usada (o que
responde "quem usa `--cor-primaria`?").

### Desfazer

**Ctrl+Z** e **Ctrl+Shift+Z** funcionam dentro da view, e há botões de seta na barra que dizem o que
vão desfazer. Guarda 50 passos.

> Dentro de um campo de texto, o Ctrl+Z continua desfazendo a digitação — não o arquivo inteiro.

### Modo código

O botão `</>` mostra o texto cru do arquivo. Existe por confiança: dá para conferir a qualquer
momento que o plugin mexeu só no que devia. Editar por lá também funciona.

---

## Salvamento

**Salva sozinho, 400ms depois** de você mexer em qualquer controle. Não há botão de salvar.

- Sliders e seletor de cor gravam quando você **solta**, não enquanto arrasta — assim dá para
  explorar uma cor sem sujar o arquivo com cada tom.
- Campos de texto gravam quando você **sai do campo** ou aperta Enter.

O atraso existe para não disparar o hot reload do servidor de desenvolvimento dezenas de vezes por
gesto.

---

## Configurações

| Opção | O que faz |
|---|---|
| **Tipos de arquivo** | Fichas para ligar `.css`, `.scss`, `.json`, `.txt`, `.env`, `.ini` e outros |
| **Esconder arquivos de máquina** | Ignora `node_modules`, `dist`, `.git`, `package.json` e afins no explorador |
| **Mostrar os elementos** | Liga a aba "Elementos" com as regras do arquivo |
| **Mostrar as explicações** | A linha com a lâmpada no topo de cada lista |
| **Abrir direto na interface** | Clicar num arquivo no explorador nativo do Obsidian já mostra os controles |

> ⚠️ Mudar os **tipos de arquivo** só faz efeito depois de **reiniciar o Obsidian** (ou desativar e
> reativar o plugin). É uma limitação da API: o Obsidian só registra extensões no carregamento. Os
> arquivos aparecem na árvore do explorador imediatamente, mas abrir só funciona após o reinício.

---

## O que o plugin não faz

Ser explícito sobre os limites evita surpresa:

- **Não interpreta o arquivo inteiro.** Só o que ele reconhece vira controle. O resto continua lá,
  intocado — e o rodapé da tela diz quantos trechos são.
- **Não resolve `var()` nem `calc()`.** Um valor que aponta para outra variável é mostrado como
  referência, não como cor fixa. Transformá-lo quebraria o encadeamento que você montou.
- **Não sabe em que páginas uma regra aparece.** O CSS não guarda essa informação — só o HTML
  saberia. O (i) explica *quando* a regra vale, que é o que o seletor realmente diz.
- **Não renomeia nem reordena variáveis.** Isso continua sendo trabalho de código.
- **Não mostra prévia do seu site.** O navegador com o dev server já mostra a verdade; uma prévia
  aproximada dentro do Obsidian poderia mentir.

---

## Formatos suportados

| Formato | Extensões | O que vira controle |
|---|---|---|
| Folhas de estilo | `.css` `.scss` `.sass` `.less` | variáveis `--nome: valor` e propriedades das regras |
| JSON | `.json` `.jsonc` | valores de chaves (sem reformatar o arquivo) |
| Texto simples | `.txt` `.env` `.ini` `.properties` `.conf` | linhas no formato `chave = valor` |

O JSON é reescrito com corte e colagem de texto, não com `JSON.parse`/`stringify` — que reformataria
o arquivo inteiro e sujaria o diff.

---

## Licença

MIT
