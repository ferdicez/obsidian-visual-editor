import { App, Modal, Setting } from "obsidian";
import { nomeValido } from "./extrair";
import { Campo } from "./tipos";

/**
 * Pergunta o nome da variável antes de extrair.
 *
 * Existe um modal em vez de um nome automático porque nomear é a parte que só ela pode fazer: o
 * plugin sabe que `24px` é um espaçamento, mas não se aquilo é "espaço do painel", "espaço da
 * seção" ou "respiro". Um nome inventado entraria no design system dela para sempre.
 */
export class ModalNomeVariavel extends Modal {
	private nome: string;
	private readonly declaradas: string[];
	private readonly aoConfirmar: (nome: string) => void;

	private aviso!: HTMLElement;
	private botaoCriar!: HTMLButtonElement;

	constructor(app: App, sugestao: string, declaradas: string[], aoConfirmar: (nome: string) => void) {
		super(app);
		this.nome = sugestao;
		this.declaradas = declaradas;
		this.aoConfirmar = aoConfirmar;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("visual-editor-modal");

		contentEl.createEl("h3", { text: "Extrair para variável" });
		contentEl.createDiv({
			cls: "ve-modal-nota",
			text: "A variável é criada no :root e a propriedade passa a usá-la.",
		});

		let entrada: HTMLInputElement;

		new Setting(contentEl).setName("Nome").addText((texto) => {
			entrada = texto.inputEl;
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

		// O nome sugerido vem selecionado: ela digita por cima se não gostar, ou dá Enter e segue.
		window.setTimeout(() => {
			entrada.focus();
			entrada.select();
		}, 0);
	}

	private validar(): void {
		let erro = "";

		if (!this.nome) erro = "";
		else if (!nomeValido(this.nome)) erro = "Comece com -- e use só letras, números e hífens.";
		else if (this.declaradas.includes(this.nome)) erro = "Já existe uma variável com esse nome.";

		this.aviso.setText(erro);
		this.aviso.toggleClass("is-visivel", erro !== "");

		if (this.botaoCriar) {
			this.botaoCriar.disabled = erro !== "" || !this.nome;
		}
	}

	private confirmar(): void {
		if (!nomeValido(this.nome) || this.declaradas.includes(this.nome)) return;
		this.close();
		this.aoConfirmar(this.nome);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Sugere um nome a partir da regra e da propriedade: `.card { padding }` → `--card-padding`.
 *
 * É palpite, e o modal deixa ela trocar. Um palpite razoável é o que faz a operação valer a pena —
 * digitar o nome inteiro toda vez cansaria mais do que editar o CSS na mão.
 */
export function sugerirNome(campo: Campo, declaradas: string[]): string {
	const seletor = (campo.seletor ?? "")
		// Só o último nível interessa: `@media … › .card` vira "card".
		.split("›")
		.pop()!
		// Primeiro alvo de uma lista: `h1, h2, h3` vira "h1".
		.split(",")[0]
		.trim()
		// Fora pseudo-classes e pseudo-elementos: `.card:hover` vira "card".
		.replace(/::?[\w-]+(\([^)]*\))?/g, "")
		.replace(/[.#>+~[\]="'*]/g, " ")
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.pop() ?? "";

	const propriedade = (campo.propriedade ?? "valor").replace(/^-+/, "");

	const base = seletor ? `--${limpar(seletor)}-${limpar(propriedade)}` : `--${limpar(propriedade)}`;

	// Sufixo numérico se já existir: sugerir um nome que o próprio plugin recusaria seria um beco.
	if (!declaradas.includes(base)) return base;

	for (let n = 2; n < 100; n++) {
		const tentativa = `${base}-${n}`;
		if (!declaradas.includes(tentativa)) return tentativa;
	}
	return base;
}

/** Deixa só o que vale num identificador CSS. */
function limpar(texto: string): string {
	return texto
		.toLowerCase()
		.normalize("NFD")
		// Tira os acentos que a decomposição separou: `--espaço` não é identificador válido.
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}
