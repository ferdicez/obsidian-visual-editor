import { App, FuzzyMatch, FuzzySuggestModal, getIconIds, setIcon } from "obsidian";

/**
 * Busca de ícones Lucide para a seção Ícones do Design System.
 *
 * Portado do `ModalEscolherIcone` do My Tasks (mesmo motor de busca) — nome de arquivo com sufixo
 * `-ds` para não colidir se um dia este plugin ganhar outro seletor de ícone fora do Design System.
 * Ver `plugins/_docs/painel-de-configuracoes.md`: todo seletor de ícone do vault segue esse padrão.
 */

let idsCache: string[] | null = null;

/** Todos os ícones que o Obsidian suporta (Lucide), sem o prefixo "lucide-". */
function todosOsIcones(): string[] {
	if (!idsCache) {
		idsCache = getIconIds().map((id) => (id.startsWith("lucide-") ? id.slice("lucide-".length) : id));
	}
	return idsCache;
}

export class ModalEscolherIconeDS extends FuzzySuggestModal<string> {
	constructor(app: App, private readonly aoEscolher: (icone: string) => void) {
		super(app);
		this.setPlaceholder("Buscar ícone…");
		this.setInstructions([
			{ command: "↑↓", purpose: "navegar" },
			{ command: "↵", purpose: "escolher" },
			{ command: "esc", purpose: "cancelar" },
		]);
	}

	getItems(): string[] {
		return todosOsIcones();
	}

	getItemText(icone: string): string {
		return icone;
	}

	renderSuggestion(match: FuzzyMatch<string>, el: HTMLElement): void {
		el.addClass("ve-icone-sugestao");
		setIcon(el.createSpan({ cls: "ve-icone-sugestao-icone" }), match.item);
		el.createSpan({ cls: "ve-icone-sugestao-nome", text: match.item });
	}

	onChooseItem(icone: string): void {
		this.aoEscolher(icone);
	}
}
