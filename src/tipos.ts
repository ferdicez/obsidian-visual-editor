/**
 * O vocabulário comum aos três leitores (CSS, JSON, texto).
 *
 * A ideia central do plugin: um arquivo de projeto é lido como uma lista de CAMPOS editáveis, e
 * cada campo sabe se reescrever no texto original SEM tocar em mais nada. O que o leitor não
 * entende não vira campo — e por não virar campo, nunca é reescrito. É essa a garantia de que
 * abrir um arquivo aqui não pode corromper o projeto dela.
 */

/** Que controle desenhar para um campo. Deduzido do valor, não declarado pela usuária. */
export type TipoCampo =
	| "cor"
	| "medida"
	| "numero"
	| "booleano"
	| "fonte"
	| "sombra"
	| "opcoes"
	| "texto"
	| "textoLongo";

/**
 * Um valor editável dentro de um arquivo.
 *
 * `inicio`/`fim` são deslocamentos no texto ORIGINAL, delimitando exatamente os caracteres do
 * VALOR (nunca o nome, nunca o `;`, nunca o espaço em volta). Reescrever é cortar esse pedaço e
 * colar o novo — por isso o resto do arquivo sobrevive intacto, byte por byte.
 */
export interface Campo {
	/**
	 * Identificador ÚNICO dentro do arquivo — é por ele que a escrita encontra o campo.
	 *
	 * Normalmente é o nome real (a variável em CSS, o caminho da chave em JSON), mas quando o mesmo
	 * nome aparece duas vezes (tema escuro, media query) ele ganha um sufixo para não colidir. Para
	 * mostrar na tela use `nomeReal`, nunca isto.
	 */
	chave: string;
	/** O nome como está escrito no arquivo, para a usuária casar com o código. */
	nomeReal: string;
	/** Como o campo aparece na tela. Em CSS, `--cor-primaria` vira "Cor primária". */
	rotulo: string;
	valor: string;
	tipo: TipoCampo;
	inicio: number;
	fim: number;
	/** Seção onde o campo é agrupado na tela (o seletor CSS, o objeto pai do JSON…). */
	grupo: string;
	/**
	 * Título da seção declarada no arquivo (`/* === Cores === *​/`), quando existe.
	 *
	 * É o agrupamento que respeita a organização que ela já escreveu: o seletor CSS joga o arquivo
	 * inteiro num `:root` só, e o comentário de seção é a intenção dela, não a estrutura da
	 * linguagem.
	 */
	secao?: string;
	/** Prefixo do nome (`--color-linha` → "color"), para agrupar sem depender de comentário. */
	prefixo?: string;
	/**
	 * O papel do campo no arquivo.
	 *
	 * `variavel` é uma declaração de custom property (`--cor: red`) — o token em si. `propriedade` é
	 * uma declaração comum dentro de uma regra (`.card { padding: 16px }`) — o USO. A distinção
	 * importa porque só propriedade pode ser ligada a uma variável, e só variável pode ser o alvo
	 * dessa ligação.
	 *
	 * Ausente significa `variavel`: os leitores de JSON e texto não têm essa noção, e os campos
	 * gravados antes desta distinção existir continuam válidos.
	 */
	papel?: "variavel" | "propriedade";
	/** Só para `propriedade`: o seletor da regra onde ela mora (`.card`, `.botao:hover`). */
	seletor?: string;
	/**
	 * Só para `propriedade`: o nome CSS da propriedade (`box-shadow`, `padding`).
	 *
	 * Separado de `rotulo` porque o rótulo é humanizado para leitura e este é o nome exato — é por
	 * ele que se decide quais variáveis fazem sentido oferecer no menu de ligação.
	 */
	propriedade?: string;
	/**
	 * Só para `propriedade`: as variáveis que o valor já referencia.
	 *
	 * `padding: var(--sm) var(--lg)` tem duas. Vazio significa valor literal — o candidato natural
	 * para a extração.
	 */
	variaveisUsadas?: string[];
	/** Comentário encontrado junto do campo, mostrado como descrição. */
	descricao?: string;
	/** Para o tipo "opcoes": os valores aceitos. */
	opcoes?: string[];
	/** Para "medida": a unidade separada do número, para o slider poder trabalhar. */
	unidade?: string;
	/** Faixa sugerida do slider, quando o tipo é "medida" ou "numero". */
	minimo?: number;
	maximo?: number;
	passo?: number;
	/**
	 * Só JSON: o recorte `inicio`/`fim` abraça as aspas de uma string literal.
	 *
	 * Decide como o valor volta ao arquivo. Uma string precisa ser reescrita com aspas e escape
	 * (`JSON.stringify`); um número ou booleano vai cru. Sem esta marca, editar um texto que
	 * contenha aspas geraria JSON inválido e derrubaria o build do projeto.
	 */
	origemComAspas?: boolean;
}

/** O resultado de ler um arquivo: os campos achados, na ordem em que aparecem. */
export interface Documento {
	campos: Campo[];
	/** Trechos que o leitor NÃO entendeu, para o aviso de "isto aqui não é editável na interface". */
	naoEditaveis: number;
}

/**
 * Aplica novos valores ao texto original.
 *
 * Escreve de trás para frente: cada substituição desloca tudo o que vem depois dela, então mexer
 * do fim para o começo mantém os `inicio`/`fim` dos campos ainda não processados válidos. Fazer na
 * ordem direta exigiria recalcular o deslocamento a cada troca — mais código e mais chance de erro.
 */
export function aplicarValores(original: string, campos: Campo[], novos: Map<string, string>): string {
	const alterados = campos
		.filter((campo) => {
			const novo = novos.get(campo.chave);
			return novo !== undefined && novo !== campo.valor;
		})
		.sort((a, b) => b.inicio - a.inicio);

	let texto = original;
	for (const campo of alterados) {
		const novo = novos.get(campo.chave)!;
		texto = texto.slice(0, campo.inicio) + novo + texto.slice(campo.fim);
	}
	return texto;
}

/** `--cor-primaria` / `corPrimaria` / `cor_primaria` → "Cor primária" (a acentuação é dela, não nossa). */
export function humanizar(chave: string): string {
	const limpo = chave
		.replace(/^--/, "")
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[-_.]+/g, " ")
		.trim();

	if (!limpo) return chave;
	return limpo.charAt(0).toUpperCase() + limpo.slice(1);
}
