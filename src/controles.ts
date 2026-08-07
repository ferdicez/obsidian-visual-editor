import { setIcon } from "obsidian";
import { corTemAlfa, paraHex, partirMedida } from "./deduzir";
import { Campo } from "./tipos";

/**
 * Os controles que a usuária manipula. Cada função desenha UM campo e chama `aoMudar` com o novo
 * valor em texto — já no formato que vai para o arquivo.
 *
 * Duas regras valem para todos:
 *
 * 1. **Digitar não salva a cada tecla.** Campos de texto avisam no `blur` e no Enter; sliders e
 *    seletor de cor avisam no `change` (fim do gesto), não no `input`. Salvar a cada caractere
 *    dispararia o hot reload do dev server dezenas de vezes por palavra.
 * 2. **O valor mostrado é o do arquivo.** Nenhum controle inventa um padrão: se o arquivo diz
 *    `1.5rem`, o slider nasce em 1,5 e a unidade continua `rem` ao salvar.
 */

type AoMudar = (novo: string) => void;

export function desenharControle(pai: HTMLElement, campo: Campo, aoMudar: AoMudar): void {
	switch (campo.tipo) {
		case "cor":
			desenharCor(pai, campo, aoMudar);
			break;
		case "medida":
			desenharMedida(pai, campo, aoMudar);
			break;
		case "numero":
			desenharNumero(pai, campo, aoMudar);
			break;
		case "booleano":
			desenharBooleano(pai, campo, aoMudar);
			break;
		case "fonte":
			desenharFonte(pai, campo, aoMudar);
			break;
		case "sombra":
			desenharSombra(pai, campo, aoMudar);
			break;
		case "textoLongo":
			desenharTextoLongo(pai, campo, aoMudar);
			break;
		default:
			desenharTexto(pai, campo, aoMudar);
	}
}

/**
 * Cor: amostra clicável que abre o seletor nativo + campo de texto com o valor cru.
 *
 * O campo de texto não é redundância — é a saída para tudo o que o seletor não representa:
 * `transparent`, `rgba(...)` com alfa, `var(--outra)`. Quando o valor tem alfa, a amostra vira só
 * visual (sem seletor), porque devolver opaco comeria o alfa que ela escreveu.
 */
function desenharCor(pai: HTMLElement, campo: Campo, aoMudar: AoMudar): void {
	const caixa = pai.createDiv({ cls: "ve-controle ve-controle-cor" });

	const hex = paraHex(campo.valor, pai.doc);
	const temAlfa = corTemAlfa(campo.valor);
	const podeUsarSeletor = hex !== null && !temAlfa;

	const amostra = caixa.createDiv({ cls: "ve-swatch" });
	amostra.style.background = campo.valor;
	// O xadrez atrás só aparece quando há transparência de verdade.
	if (temAlfa) amostra.addClass("is-alfa");

	const entradaTexto = caixa.createEl("input", {
		cls: "ve-entrada ve-entrada-cor",
		attr: { type: "text", spellcheck: "false", value: campo.valor },
	});

	if (podeUsarSeletor) {
		const seletor = caixa.createEl("input", {
			cls: "ve-seletor-cor",
			attr: { type: "color", value: hex! },
		});

		amostra.addClass("is-clicavel");
		amostra.setAttr("role", "button");
		amostra.setAttr("tabindex", "0");
		amostra.setAttr("aria-label", `Escolher ${campo.rotulo}`);
		amostra.addEventListener("click", () => seletor.click());
		amostra.addEventListener("keydown", (evento) => {
			if (evento.key === "Enter" || evento.key === " ") {
				evento.preventDefault();
				seletor.click();
			}
		});

		// `input` atualiza a prévia enquanto ela arrasta; `change` é o que grava. Assim ela vê a cor
		// mudando ao vivo sem escrever no arquivo (e recarregar o dev server) a cada pixel do gesto.
		seletor.addEventListener("input", () => {
			amostra.style.background = seletor.value;
			entradaTexto.value = seletor.value;
		});
		seletor.addEventListener("change", () => {
			amostra.style.background = seletor.value;
			entradaTexto.value = seletor.value;
			aoMudar(seletor.value);
		});
	} else {
		amostra.setAttr(
			"aria-label",
			temAlfa
				? "Cor com transparência — edite pelo campo de texto para preservar o alfa"
				: "Cor não representável no seletor — edite pelo campo de texto"
		);
	}

	const confirmar = () => {
		const novo = entradaTexto.value.trim();
		if (novo === campo.valor) return;
		amostra.style.background = novo;
		aoMudar(novo);
	};

	entradaTexto.addEventListener("blur", confirmar);
	entradaTexto.addEventListener("keydown", (evento) => {
		if (evento.key === "Enter") {
			evento.preventDefault();
			entradaTexto.blur();
		}
	});
}

/**
 * Medida: slider + campo numérico + unidade.
 *
 * O campo numérico existe porque o slider é bom para explorar e ruim para precisão — ela consegue
 * digitar 17 sem caçar o pixel. A unidade é mostrada como texto fixo: trocar `px` por `rem` muda o
 * significado do número, e é o tipo de mudança que se faz no código, não arrastando um controle.
 */
function desenharMedida(pai: HTMLElement, campo: Campo, aoMudar: AoMudar): void {
	const partes = partirMedida(campo.valor);
	if (!partes) {
		desenharTexto(pai, campo, aoMudar);
		return;
	}

	const caixa = pai.createDiv({ cls: "ve-controle ve-controle-medida" });

	const slider = caixa.createEl("input", {
		cls: "ve-slider",
		attr: {
			type: "range",
			min: String(campo.minimo ?? 0),
			max: String(campo.maximo ?? 100),
			step: String(campo.passo ?? 1),
			value: String(partes.numero),
		},
	});

	const numero = caixa.createEl("input", {
		cls: "ve-entrada ve-entrada-numero",
		attr: { type: "number", step: String(campo.passo ?? 1), value: String(partes.numero) },
	});

	caixa.createSpan({ cls: "ve-unidade", text: partes.unidade });

	const montar = (n: string) => `${n}${partes.unidade}`;

	slider.addEventListener("input", () => {
		numero.value = slider.value;
	});
	slider.addEventListener("change", () => aoMudar(montar(slider.value)));

	const confirmarNumero = () => {
		const bruto = numero.value.trim();
		if (bruto === "") return;
		slider.value = bruto;
		aoMudar(montar(bruto));
	};

	numero.addEventListener("blur", confirmarNumero);
	numero.addEventListener("keydown", (evento) => {
		if (evento.key === "Enter") {
			evento.preventDefault();
			numero.blur();
		}
	});
}

/** Número sem unidade (opacidade, peso da fonte, z-index). Mesmo par slider + campo. */
function desenharNumero(pai: HTMLElement, campo: Campo, aoMudar: AoMudar): void {
	const caixa = pai.createDiv({ cls: "ve-controle ve-controle-medida" });

	const slider = caixa.createEl("input", {
		cls: "ve-slider",
		attr: {
			type: "range",
			min: String(campo.minimo ?? 0),
			max: String(campo.maximo ?? 100),
			step: String(campo.passo ?? 1),
			value: campo.valor,
		},
	});

	const numero = caixa.createEl("input", {
		cls: "ve-entrada ve-entrada-numero",
		attr: { type: "number", step: String(campo.passo ?? 1), value: campo.valor },
	});

	slider.addEventListener("input", () => {
		numero.value = slider.value;
	});
	slider.addEventListener("change", () => aoMudar(slider.value));

	const confirmar = () => {
		const bruto = numero.value.trim();
		if (bruto === "") return;
		slider.value = bruto;
		aoMudar(bruto);
	};

	numero.addEventListener("blur", confirmar);
	numero.addEventListener("keydown", (evento) => {
		if (evento.key === "Enter") {
			evento.preventDefault();
			numero.blur();
		}
	});
}

/** Booleano: o interruptor nativo do Obsidian, para não destoar do resto do app. */
function desenharBooleano(pai: HTMLElement, campo: Campo, aoMudar: AoMudar): void {
	const caixa = pai.createDiv({ cls: "ve-controle" });
	const alternador = caixa.createDiv({ cls: "checkbox-container" });

	const ligado = campo.valor === "true";
	alternador.toggleClass("is-enabled", ligado);
	alternador.setAttr("role", "checkbox");
	alternador.setAttr("tabindex", "0");
	alternador.setAttr("aria-checked", String(ligado));

	const alternar = () => {
		const novo = !alternador.hasClass("is-enabled");
		alternador.toggleClass("is-enabled", novo);
		alternador.setAttr("aria-checked", String(novo));
		aoMudar(String(novo));
	};

	alternador.addEventListener("click", alternar);
	alternador.addEventListener("keydown", (evento) => {
		if (evento.key === "Enter" || evento.key === " ") {
			evento.preventDefault();
			alternar();
		}
	});
}

/**
 * Fonte: campo de texto com prévia renderizada na própria fonte.
 *
 * Um dropdown seria mentira — o plugin não sabe que fontes o projeto dela carrega. A prévia
 * resolve o que importa: ela vê na hora se a pilha de fontes está resolvendo para o que espera.
 */
function desenharFonte(pai: HTMLElement, campo: Campo, aoMudar: AoMudar): void {
	const caixa = pai.createDiv({ cls: "ve-controle ve-controle-fonte" });

	const entrada = caixa.createEl("input", {
		cls: "ve-entrada",
		attr: { type: "text", spellcheck: "false", value: campo.valor },
	});

	const previa = caixa.createDiv({ cls: "ve-previa-fonte", text: "Aa Bb Cc 123" });
	previa.style.fontFamily = campo.valor;

	entrada.addEventListener("input", () => {
		previa.style.fontFamily = entrada.value;
	});

	const confirmar = () => {
		const novo = entrada.value.trim();
		if (novo === campo.valor) return;
		aoMudar(novo);
	};

	entrada.addEventListener("blur", confirmar);
	entrada.addEventListener("keydown", (evento) => {
		if (evento.key === "Enter") {
			evento.preventDefault();
			entrada.blur();
		}
	});
}

/** Sombra: campo de texto com um quadrado de prévia aplicando a sombra de verdade. */
function desenharSombra(pai: HTMLElement, campo: Campo, aoMudar: AoMudar): void {
	const caixa = pai.createDiv({ cls: "ve-controle ve-controle-sombra" });

	const entrada = caixa.createEl("input", {
		cls: "ve-entrada",
		attr: { type: "text", spellcheck: "false", value: campo.valor },
	});

	const previa = caixa.createDiv({ cls: "ve-previa-sombra" });
	previa.style.boxShadow = campo.valor;

	entrada.addEventListener("input", () => {
		previa.style.boxShadow = entrada.value;
	});

	const confirmar = () => {
		const novo = entrada.value.trim();
		if (novo === campo.valor) return;
		aoMudar(novo);
	};

	entrada.addEventListener("blur", confirmar);
	entrada.addEventListener("keydown", (evento) => {
		if (evento.key === "Enter") {
			evento.preventDefault();
			entrada.blur();
		}
	});
}

/** Texto de uma linha. */
function desenharTexto(pai: HTMLElement, campo: Campo, aoMudar: AoMudar): void {
	const caixa = pai.createDiv({ cls: "ve-controle" });

	const entrada = caixa.createEl("input", {
		cls: "ve-entrada",
		attr: { type: "text", spellcheck: "false", value: campo.valor },
	});

	const confirmar = () => {
		const novo = entrada.value;
		if (novo === campo.valor) return;
		aoMudar(novo);
	};

	entrada.addEventListener("blur", confirmar);
	entrada.addEventListener("keydown", (evento) => {
		if (evento.key === "Enter") {
			evento.preventDefault();
			entrada.blur();
		}
	});
}

/**
 * Texto longo: textarea que cresce com o conteúdo.
 *
 * Enter aqui insere quebra de linha em vez de confirmar — é texto de parágrafo. Confirma no blur
 * ou com Ctrl/Cmd+Enter.
 */
function desenharTextoLongo(pai: HTMLElement, campo: Campo, aoMudar: AoMudar): void {
	const caixa = pai.createDiv({ cls: "ve-controle" });

	const area = caixa.createEl("textarea", {
		cls: "ve-entrada ve-area",
		attr: { spellcheck: "false", rows: "3" },
	});
	area.value = campo.valor;

	const ajustarAltura = () => {
		area.style.height = "auto";
		area.style.height = `${area.scrollHeight}px`;
	};
	// A altura inicial só é calculável depois que o elemento está no layout.
	window.setTimeout(ajustarAltura, 0);
	area.addEventListener("input", ajustarAltura);

	const confirmar = () => {
		const novo = area.value;
		if (novo === campo.valor) return;
		aoMudar(novo);
	};

	area.addEventListener("blur", confirmar);
	area.addEventListener("keydown", (evento) => {
		if (evento.key === "Enter" && (evento.ctrlKey || evento.metaKey)) {
			evento.preventDefault();
			area.blur();
		}
	});
}

/** Botão de ícone padrão do Obsidian, usado na barra da view. */
export function botaoIcone(pai: HTMLElement, icone: string, rotulo: string, aoClicar: () => void): HTMLElement {
	const botao = pai.createEl("button", { cls: "ve-botao-icone", attr: { "aria-label": rotulo, type: "button" } });
	setIcon(botao, icone);
	botao.addEventListener("click", aoClicar);
	return botao;
}
