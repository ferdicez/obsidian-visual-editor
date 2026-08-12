import { setIcon } from "obsidian";

/**
 * Seção recolhível — o mesmo acordeão dos outros plugins do cofre.
 *
 * Portado de `dash-home/src/acordeao.ts` (que veio do My Tasks) trocando só o prefixo, como manda
 * a especificação dos painéis: o padrão é portado, não reescrito.
 *
 * Aqui ele serve à LISTA de controles, não a um painel de configurações: um `global.css` de
 * verdade rende 117 tokens, e rolar tudo isso para achar um grupo é o que ela relatou. Duas
 * propriedades da versão original importam ainda mais neste uso:
 *
 * 1. **Abrir/fechar não redesenha a tela.** O clique só troca classes CSS. A versão anterior
 *    chamava `atualizar()`, que recriava o painel inteiro — perdendo foco de campo e posição de
 *    scroll a cada clique.
 * 2. **O conteúdo fechado não é desenhado.** `sePreenchido` adia o desenho até a primeira
 *    abertura; seções caras (que varrem o vault) não pagam custo enquanto estão fechadas.
 */

/**
 * Estado de aberto/fechado por chave. Vive no MÓDULO, não na instância do painel, porque
 * `display()` reconstrói a tela inteira a cada gravação: sem isso, mexer em qualquer campo
 * dentro de um acordeão o fecharia na cara dela no meio da edição.
 */
const abertos = new Map<string, boolean>();

export interface OpcoesAcordeao {
	/**
	 * Chave estável para lembrar aberto/fechado entre redesenhos. Precisa ser única na tela e
	 * não pode depender de índice de lista — senão reordenar embaralha o estado.
	 */
	chave: string;
	titulo: string;
	descricao?: string;
	/** Texto curto à direita do título (ex.: "3 botões"). */
	resumo?: string;
	/** Começa aberto na PRIMEIRA vez que aparece; depois vale o que a usuária deixou. */
	abertoPorPadrao?: boolean;
	/** Acordeão aninhado: recua e afina o título, para o nível de dentro não competir com o de fora. */
	aninhado?: boolean;
}

export interface Acordeao {
	/** A seção inteira — use para pendurar botões de ação no cabeçalho. */
	secao: HTMLElement;
	/** O cabeçalho clicável, onde ações extras podem ser inseridas. */
	cabecalho: HTMLElement;
	/** Onde o conteúdo da seção é desenhado. */
	corpo: HTMLElement;
	/** Chamado só quando a seção está ABERTA (ou na primeira abertura). */
	sePreenchido: (desenhar: (corpo: HTMLElement) => void) => void;
}

export function criarAcordeao(container: HTMLElement, opcoes: OpcoesAcordeao): Acordeao {
	const aberto = abertos.get(opcoes.chave) ?? opcoes.abertoPorPadrao ?? false;
	abertos.set(opcoes.chave, aberto);

	const secao = container.createDiv({ cls: "ve-acordeao" });
	if (opcoes.aninhado) secao.addClass("ve-acordeao-aninhado");
	secao.toggleClass("ve-acordeao-aberto", aberto);

	// <button> de propósito: dá foco por teclado e Enter/Espaço de graça, que uma <div> não tem.
	const cabecalho = secao.createEl("button", {
		cls: "ve-acordeao-cabecalho",
		attr: { "aria-expanded": String(aberto) },
	});

	const seta = cabecalho.createSpan({ cls: "ve-acordeao-seta" });
	setIcon(seta, "chevron-right");

	const textos = cabecalho.createDiv({ cls: "ve-acordeao-textos" });
	textos.createSpan({ cls: "ve-acordeao-titulo", text: opcoes.titulo });
	if (opcoes.descricao) {
		textos.createDiv({ cls: "ve-acordeao-descricao", text: opcoes.descricao });
	}
	if (opcoes.resumo) {
		cabecalho.createSpan({ cls: "ve-acordeao-resumo", text: opcoes.resumo });
	}

	const corpo = secao.createDiv({ cls: "ve-acordeao-corpo" });
	if (!aberto) corpo.addClass("ve-oculto");

	// Guarda o desenhador para a primeira abertura, quando a seção nasce fechada. Declarado ANTES
	// do listener que o usa — `let` não sofre hoisting de valor.
	let desenharPendente: ((corpo: HTMLElement) => void) | null = null;

	cabecalho.addEventListener("click", (evento) => {
		// Botões de ação dentro do cabeçalho (subir, descer, excluir) não devem abrir/fechar.
		if ((evento.target as HTMLElement).closest(".ve-acordeao-acoes")) return;

		const novoEstado = !(abertos.get(opcoes.chave) ?? false);
		abertos.set(opcoes.chave, novoEstado);
		secao.toggleClass("ve-acordeao-aberto", novoEstado);
		corpo.toggleClass("ve-oculto", !novoEstado);
		cabecalho.setAttr("aria-expanded", String(novoEstado));

		if (novoEstado && desenharPendente) {
			const desenhar = desenharPendente;
			desenharPendente = null;
			desenhar(corpo);
		}
	});

	return {
		secao,
		cabecalho,
		corpo,
		sePreenchido: (desenhar) => {
			if (aberto) {
				desenhar(corpo);
				return;
			}
			desenharPendente = desenhar;
		},
	};
}

/**
 * Marca um acordeão como aberto ANTES de ele ser desenhado. Usado ao criar um item novo (um
 * quadrante, por exemplo): ele nasce expandido e pronto para ser preenchido, em vez de fechado
 * no fim da lista.
 */
export function abrirAcordeao(chave: string): void {
	abertos.set(chave, true);
}
