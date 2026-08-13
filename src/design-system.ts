import { criarAcordeao } from "./acordeao";
import { Formato } from "./documento";
import { Campo } from "./tipos";

/**
 * A aba Design System: um catálogo curado de papéis de token, em vez da lista bruta que Tokens
 * mostra. Onde Tokens exibe o que o arquivo JÁ tem, esta aba mostra o que um design system
 * PRECISA ter — inclusive os papéis que o arquivo ainda não declarou ("de reserva").
 *
 * Nasceu de um mockup HTML validado fora do Obsidian (ver `plugins/_docs/visual-editor.md`).
 * Primeira seção construída: Cores principais. As demais (Status, Background/Texto/Cards, Botões,
 * Tipografia, Sombra, Espaço/Raio, Alerts) seguem o mesmo padrão depois de validada esta.
 */

export interface AcoesDesignSystem {
	/** Grava um valor num token que JÁ existe no arquivo. */
	aplicarToken: (chave: string, novo: string) => void;
	/**
	 * Declara um token que ainda não existe (papel "de reserva"), e o aplica em seguida.
	 * Quando falha (sem `:root`/`@theme` no arquivo), mostra o motivo em vez de falhar em silêncio.
	 */
	criarToken: (nome: string, valorInicial: string) => void;
}

/** Um papel de cor dentro de "Cores principais": nome fixo do token + rótulo mostrado na tela. */
interface PapelPrincipal {
	tokenBase: string; // "--principal-1"
	rotulo: string; // "Principal 1"
}

const PAPEIS_PRINCIPAIS: PapelPrincipal[] = [
	{ tokenBase: "--principal-1", rotulo: "Principal 1" },
	{ tokenBase: "--principal-2", rotulo: "Principal 2" },
	{ tokenBase: "--principal-3", rotulo: "Principal 3" },
	{ tokenBase: "--principal-4", rotulo: "Principal 4" },
	{ tokenBase: "--principal-5", rotulo: "Principal 5" },
];

/**
 * A escala de tons oferecida por padrão quando o papel ainda não tem token no arquivo.
 *
 * Cinco tons, do mais claro ao mais escuro, girando em torno de um tom médio neutro — só para dar
 * um ponto de partida visual. Uma vez que a usuária escolhe um tom (ou digita um hex), o token
 * grava o valor dela, não um destes.
 */
const ESCALA_PADRAO = ["#f5f5f7", "#c7c9d6", "#8a8da3", "#52556b", "#26283a"];

export function desenharDesignSystem(pai: HTMLElement, campos: Campo[], formato: Formato, acoes: AcoesDesignSystem): void {
	const raiz = pai.createDiv({ cls: "ve-ds" });

	if (formato !== "css") {
		raiz.createDiv({
			cls: "ve-ds-aviso",
			text: "O catálogo de Design System só está disponível para arquivos CSS — é onde tokens (--nome: valor) fazem sentido.",
		});
		return;
	}

	const porToken = new Map(campos.filter((c) => c.papel !== "propriedade").map((c) => [c.nomeReal, c]));

	desenharSecaoCoresPrincipais(raiz, porToken, acoes);
}

function desenharSecaoCoresPrincipais(
	raiz: HTMLElement,
	porToken: Map<string, Campo>,
	acoes: AcoesDesignSystem
): void {
	const acordeao = criarAcordeao(raiz, {
		chave: "design-system|cores-principais",
		titulo: "1. Cores principais",
		descricao: "As cinco cores que carregam a identidade do projeto. Cada uma tem uma escala de tons — escolha o que for oficial, ou digite um hex à parte.",
		resumo: `${PAPEIS_PRINCIPAIS.length} papéis`,
		abertoPorPadrao: true,
	});

	acordeao.sePreenchido((corpo) => {
		const grade = corpo.createDiv({ cls: "ve-ds-grade ve-ds-grade-principais" });

		for (const papel of PAPEIS_PRINCIPAIS) {
			desenharCorPrincipal(grade, papel, porToken.get(papel.tokenBase) ?? null, acoes);
		}
	});
}

function desenharCorPrincipal(
	pai: HTMLElement,
	papel: PapelPrincipal,
	campo: Campo | null,
	acoes: AcoesDesignSystem
): void {
	const cartao = pai.createDiv({ cls: "ve-ds-cartao" });
	if (!campo) cartao.addClass("is-reserva");

	const cabecalho = cartao.createDiv({ cls: "ve-ds-cartao-cabecalho" });
	cabecalho.createSpan({ cls: "ve-ds-cartao-rotulo", text: papel.rotulo });
	if (!campo) cabecalho.createSpan({ cls: "ve-ds-badge-reserva", text: "reserva" });

	const valorAtual = campo?.valor ?? ESCALA_PADRAO[2];
	const blocoOficial = cartao.createDiv({ cls: "ve-ds-bloco-oficial" });
	blocoOficial.style.background = valorAtual;

	const escala = cartao.createDiv({ cls: "ve-ds-escala" });
	const tons = ESCALA_PADRAO;

	const tonEls: HTMLElement[] = [];
	for (const tom of tons) {
		const tonEl = escala.createDiv({ cls: "ve-ds-tom" });
		tonEl.style.background = tom;
		tonEl.setAttr("role", "button");
		tonEl.setAttr("aria-label", `Usar ${tom} como ${papel.rotulo}`);
		tonEl.toggleClass("is-oficial", !!campo && ambosProximos(campo.valor, tom));
		tonEls.push(tonEl);

		tonEl.addEventListener("click", () => {
			tonEls.forEach((t) => t.removeClass("is-oficial"));
			tonEl.addClass("is-oficial");
			blocoOficial.style.background = tom;
			if (campoEntrada) campoEntrada.value = tom;
			gravar(tom);
		});
	}

	const linhaValor = cartao.createDiv({ cls: "ve-ds-linha-valor" });
	const campoEntrada = linhaValor.createEl("input", {
		cls: "ve-ds-entrada-hex",
		attr: { type: "text", spellcheck: "false", value: campo?.valor ?? "" , placeholder: campo ? "" : "— vazio —" },
	});

	const confirmarTexto = () => {
		const valor = campoEntrada.value.trim();
		if (!valor) return;
		blocoOficial.style.background = valor;
		tonEls.forEach((t) => t.toggleClass("is-oficial", ambosProximos(valor, t.style.background)));
		gravar(valor);
	};
	campoEntrada.addEventListener("blur", confirmarTexto);
	campoEntrada.addEventListener("keydown", (evento) => {
		if (evento.key === "Enter") campoEntrada.blur();
	});

	function gravar(valor: string): void {
		cartao.removeClass("is-reserva");
		const badge = cabecalho.querySelector(".ve-ds-badge-reserva");
		if (badge) badge.remove();

		if (campo) {
			acoes.aplicarToken(campo.chave, valor);
		} else {
			acoes.criarToken(papel.tokenBase, valor);
		}
	}
}

/**
 * Compara dois valores de cor de forma tolerante a formatação (maiúsculas, `background: rgb(...)`
 * vs. hex) para decidir se um tom da escala é "o mesmo" que o valor gravado no arquivo.
 *
 * Não precisa ser exata: é só para destacar visualmente qual tom bate com o token — errar para
 * "nenhum destacado" é seguro, nunca destaca o tom errado por engano de formatação de cor.
 */
function ambosProximos(a: string, b: string): boolean {
	return a.trim().toLowerCase() === b.trim().toLowerCase();
}
