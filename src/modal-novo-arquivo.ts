import { AbstractInputSuggest, App, Modal, Setting, TFolder } from "obsidian";

/**
 * Sugere pastas do vault ao digitar, igual ao seletor de arquivos do My Tasks — mesma classe base do
 * Obsidian, trocando `TFile` por `TFolder` porque aqui o alvo é onde salvar, não o que abrir.
 */
class SugestorPastas extends AbstractInputSuggest<TFolder> {
	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
	}

	getSuggestions(query: string): TFolder[] {
		const q = query.toLowerCase();
		const pastas: TFolder[] = [];
		const raiz = this.app.vault.getRoot();
		pastas.push(raiz);

		const percorrer = (pasta: TFolder) => {
			for (const filho of pasta.children) {
				if (filho instanceof TFolder) {
					pastas.push(filho);
					percorrer(filho);
				}
			}
		};
		percorrer(raiz);

		return pastas.filter((p) => p.path.toLowerCase().includes(q)).slice(0, 50);
	}

	renderSuggestion(pasta: TFolder, el: HTMLElement): void {
		el.setText(pasta.path === "/" ? "/ (raiz do cofre)" : pasta.path);
	}

	selectSuggestion(pasta: TFolder): void {
		this.setValue(pasta.path === "/" ? "" : pasta.path);
		this.close();
	}
}

/**
 * Pergunta pasta e nome antes de criar um arquivo novo (hoje só o CSS de Design System).
 *
 * Existe porque criar direto numa pasta fixa colidiria com um arquivo homônimo dela, e cravar a raiz
 * do cofre presumiria uma organização que só ela conhece — cada projeto mora numa pasta diferente.
 */
export class ModalNovoArquivo extends Modal {
	private pasta: string;
	private nome: string;

	private aviso!: HTMLElement;
	private botaoCriar!: HTMLButtonElement;

	constructor(
		app: App,
		private readonly nomeSugerido: string,
		private readonly aoConfirmar: (caminho: string) => void
	) {
		super(app);
		this.pasta = "";
		this.nome = nomeSugerido;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("visual-editor-modal");

		contentEl.createEl("h3", { text: "Criar arquivo de Design System" });
		contentEl.createDiv({
			cls: "ve-modal-nota",
			text: "Um arquivo CSS novo, com o bloco :root pronto para receber os tokens. Abre direto na aba Design System.",
		});

		new Setting(contentEl).setName("Pasta").addText((texto) => {
			texto.setPlaceholder("Raiz do cofre").onChange((valor) => {
				this.pasta = valor.trim();
			});
			new SugestorPastas(this.app, texto.inputEl);
		});

		new Setting(contentEl).setName("Nome do arquivo").addText((texto) => {
			texto.setValue(this.nome).onChange((valor) => {
				this.nome = valor.trim();
				this.validar();
			});
			texto.inputEl.addEventListener("keydown", (evento) => {
				if (evento.key === "Enter") {
					evento.preventDefault();
					if (!this.botaoCriar.disabled) this.confirmar();
				}
			});
			window.setTimeout(() => {
				texto.inputEl.focus();
				texto.inputEl.select();
			}, 0);
		});

		this.aviso = contentEl.createDiv({ cls: "ve-modal-aviso" });

		new Setting(contentEl)
			.addButton((botao) =>
				botao
					.setButtonText("Criar")
					.setCta()
					.onClick(() => this.confirmar())
					.then((b) => {
						this.botaoCriar = b.buttonEl;
					})
			)
			.addButton((botao) => botao.setButtonText("Cancelar").onClick(() => this.close()));

		this.validar();
	}

	private caminhoCompleto(): string {
		const nome = this.nome.endsWith(".css") ? this.nome : `${this.nome}.css`;
		return this.pasta ? `${this.pasta}/${nome}` : nome;
	}

	private validar(): void {
		let erro = "";

		if (!this.nome) erro = "";
		else if (/[\\/:*?"<>|]/.test(this.nome.replace(/\.css$/, ""))) {
			erro = "O nome não pode ter esses caracteres: \\ / : * ? \" < > |";
		} else if (this.app.vault.getAbstractFileByPath(this.caminhoCompleto())) {
			erro = "Já existe um arquivo com esse nome nessa pasta.";
		}

		this.aviso.setText(erro);
		this.aviso.toggleClass("is-visivel", erro !== "");

		if (this.botaoCriar) {
			this.botaoCriar.disabled = erro !== "" || !this.nome;
		}
	}

	private confirmar(): void {
		this.validar();
		if (this.botaoCriar.disabled) return;
		this.close();
		this.aoConfirmar(this.caminhoCompleto());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
