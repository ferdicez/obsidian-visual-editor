import { setIcon } from "obsidian";
import { desenharControle } from "./controles";
import type { ParteExplicada } from "./explicar-seletor";
import { Campo } from "./tipos";

/**
 * A janelinha que edita um token sem sair da aba Elementos.
 *
 * Antes, clicar numa ficha de variável trocava de aba e rolava até o token — ela perdia o lugar onde
 * estava na lista de regras. Pedido dela: *"ao invés de voltar para a página do CSS, talvez abrir
 * uma janelinha e aí o que eu editar na janelinha edita automaticamente no CSS?"*
 *
 * É um popover e não um modal de propósito: modal escurece o fundo e rouba o foco da tela toda, o
 * que para "ajustar um valor e continuar lendo a lista" é pesado demais. Aqui a lista continua
 * visível atrás, e o gesto de fechar é clicar fora.
 */
export class PopoverToken {
	private el: HTMLElement | null = null;
	private aoFechar: (() => void) | null = null;

	/**
	 * Abre a janelinha ancorada num elemento.
	 *
	 * `usos` é a lista de regras que usam este token — é o que responde "se eu mexer aqui, o que mais
	 * muda?", pergunta que o valor sozinho não responde e que faz diferença antes de editar.
	 */
	abrir(
		ancora: HTMLElement,
		token: Campo,
		usos: string[],
		aoMudar: (novo: string) => void,
		aoIrParaToken: () => void
	): void {
		this.fechar();

		const doc = ancora.doc;
		const el = doc.body.createDiv({ cls: "visual-editor-popover" });
		this.el = el;

		const cabecalho = el.createDiv({ cls: "ve-pop-cabecalho" });
		cabecalho.createSpan({ cls: "ve-pop-nome", text: token.nomeReal });

		const fechar = cabecalho.createEl("button", {
			cls: "ve-pop-fechar",
			attr: { type: "button", "aria-label": "Fechar" },
		});
		setIcon(fechar, "x");
		fechar.addEventListener("click", () => this.fechar());

		if (token.descricao) {
			el.createDiv({ cls: "ve-pop-descricao", text: token.descricao });
		}

		// O controle é o MESMO da aba Tokens — a mesma função que desenha lá. Uma segunda versão
		// simplificada aqui divergiria da outra na primeira vez que um tipo de controle mudasse.
		const corpo = el.createDiv({ cls: "ve-pop-controle" });
		desenharControle(corpo, token, aoMudar);

		if (usos.length > 0) {
			const rodape = el.createDiv({ cls: "ve-pop-usos" });
			rodape.createDiv({
				cls: "ve-pop-usos-titulo",
				text: usos.length === 1 ? "Usada em 1 lugar" : `Usada em ${usos.length} lugares`,
			});
			// Uma lista longa viraria a janela inteira; o resto fica no contador.
			for (const uso of usos.slice(0, 6)) {
				rodape.createDiv({ cls: "ve-pop-uso", text: uso });
			}
			if (usos.length > 6) {
				rodape.createDiv({ cls: "ve-pop-uso ve-pop-uso-mais", text: `e mais ${usos.length - 6}…` });
			}
		}

		const ir = el.createEl("button", { cls: "ve-pop-ir", attr: { type: "button" } });
		setIcon(ir.createSpan({ cls: "ve-pop-ir-icone" }), "list");
		ir.createSpan({ text: "Ver na aba Tokens" });
		ir.addEventListener("click", () => {
			this.fechar();
			aoIrParaToken();
		});

		this.posicionar(el, ancora);
		this.ouvirFechamento(doc, el);
	}

	/**
	 * Põe a janela ao lado da ficha, sem deixá-la sair da tela.
	 *
	 * Abre para baixo por padrão e vira para cima quando não há espaço — uma janela cortada pela
	 * borda inferior esconderia justamente o controle, que é o motivo de ela ter clicado.
	 */
	private posicionar(el: HTMLElement, ancora: HTMLElement): void {
		const caixa = ancora.getBoundingClientRect();
		const largura = el.offsetWidth;
		const altura = el.offsetHeight;
		const margem = 8;

		let esquerda = caixa.left;
		if (esquerda + largura > window.innerWidth - margem) {
			esquerda = window.innerWidth - largura - margem;
		}
		esquerda = Math.max(margem, esquerda);

		let topo = caixa.bottom + 6;
		if (topo + altura > window.innerHeight - margem) {
			const acima = caixa.top - altura - 6;
			topo = acima >= margem ? acima : Math.max(margem, window.innerHeight - altura - margem);
		}

		el.style.left = `${esquerda}px`;
		el.style.top = `${topo}px`;
	}

	/**
	 * A janelinha que explica um seletor: "quando esta regra vale".
	 *
	 * Mora aqui e não num módulo próprio porque compartilha tudo o que importa com a do token —
	 * posicionamento, fechar ao clicar fora, fechar com Esc. Duplicar isso significaria dois lugares
	 * para corrigir quando o posicionamento precisar de ajuste.
	 */
	abrirSeletor(ancora: HTMLElement, seletor: string, partes: ParteExplicada[]): void {
		this.fechar();

		const doc = ancora.doc;
		const el = doc.body.createDiv({ cls: "visual-editor-popover visual-editor-popover-seletor" });
		this.el = el;

		const cabecalho = el.createDiv({ cls: "ve-pop-cabecalho" });
		cabecalho.createSpan({ cls: "ve-pop-titulo", text: "Quando esta regra vale" });

		const fechar = cabecalho.createEl("button", {
			cls: "ve-pop-fechar",
			attr: { type: "button", "aria-label": "Fechar" },
		});
		setIcon(fechar, "x");
		fechar.addEventListener("click", () => this.fechar());

		const lista = el.createDiv({ cls: "ve-pop-condicoes" });

		for (const parte of partes) {
			const item = lista.createDiv({ cls: "ve-pop-condicao" });
			item.createDiv({ cls: "ve-pop-condicao-cru", text: parte.cru });
			if (parte.explicacao) {
				item.createDiv({ cls: "ve-pop-condicao-traducao", text: parte.explicacao });
			}
		}

		// O seletor inteiro no rodapé: as partes explicadas são o resumo, e às vezes ela precisa do
		// texto exato para achar a regra no arquivo.
		el.createDiv({ cls: "ve-pop-seletor-cru", text: seletor });

		this.posicionar(el, ancora);
		this.ouvirFechamento(doc, el);
	}

	/** Fechar ao clicar fora ou com Esc — comum às duas janelinhas. */
	private ouvirFechamento(doc: Document, el: HTMLElement): void {
		const cliqueFora = (evento: MouseEvent) => {
			if (evento.target instanceof Node && el.contains(evento.target)) return;
			this.fechar();
		};
		const tecla = (evento: KeyboardEvent) => {
			if (evento.key === "Escape") this.fechar();
		};

		// No próximo quadro: registrados agora, o próprio clique que abriu a janela a fecharia.
		window.setTimeout(() => {
			doc.addEventListener("mousedown", cliqueFora);
			doc.addEventListener("keydown", tecla);
		}, 0);

		this.aoFechar = () => {
			doc.removeEventListener("mousedown", cliqueFora);
			doc.removeEventListener("keydown", tecla);
		};
	}

	fechar(): void {
		this.aoFechar?.();
		this.aoFechar = null;
		this.el?.remove();
		this.el = null;
	}

	get aberto(): boolean {
		return this.el !== null;
	}
}
