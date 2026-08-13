import { App, FuzzyMatch, FuzzySuggestModal } from "obsidian";

/**
 * Escolher uma família tipográfica com cada nome escrito NA PRÓPRIA fonte.
 *
 * O `<select>` nativo que existia antes não deixa estilizar as opções — nem aplicar uma
 * `font-family` diferente por item, nem dar padding confortável, porque o navegador desenha o menu
 * suspenso com o próprio motor do sistema. Pedido dela: *"se puder aparecer como se fosse uma
 * miniaturazinha da letra mesmo, para eu visualizar como é a letra"*.
 *
 * `FuzzySuggestModal` resolve isso (é o mesmo padrão do `ModalEscolherIcone` do My Tasks): a lista é
 * inteiramente do plugin, então cada linha pode ter sua própria fonte.
 */
export class ModalEscolherFonte extends FuzzySuggestModal<string> {
	constructor(
		app: App,
		private readonly fontes: string[],
		private readonly aoEscolher: (fonte: string) => void
	) {
		super(app);
		this.setPlaceholder("Buscar fonte…");
		this.setInstructions([
			{ command: "↑↓", purpose: "navegar" },
			{ command: "↵", purpose: "escolher" },
			{ command: "esc", purpose: "cancelar" },
		]);
	}

	getItems(): string[] {
		return this.fontes;
	}

	getItemText(fonte: string): string {
		return fonte;
	}

	renderSuggestion(match: FuzzyMatch<string>, el: HTMLElement): void {
		el.addClass("ve-fonte-sugestao");
		el.createSpan({ cls: "ve-fonte-sugestao-amostra", text: match.item }).style.fontFamily = `"${match.item}"`;
		el.createSpan({ cls: "ve-fonte-sugestao-nome", text: match.item });
	}

	onChooseItem(fonte: string): void {
		this.aoEscolher(fonte);
	}
}
