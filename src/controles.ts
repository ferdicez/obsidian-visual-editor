import { setIcon } from "obsidian";
import { corTemAlfa, paraHex, partirMedida } from "./deduzir";
import { CamadaSombra, Medida, camadaPadrao, separarCamadas, sombraParaTexto } from "./sombra";
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
		// Sem seletor: a amostra fica marcada e DIZ por quê.
		//
		// Ela relatou que "alguns quadradinhos abrem o card de cor, outros não" — o comportamento era
		// deliberado (o seletor nativo do sistema não representa alfa, e devolver opaco comeria a
		// transparência que ela escreveu), mas nada na tela explicava isso. Um controle que às vezes
		// responde e às vezes não, sem dizer o motivo, parece defeito.
		const motivo = temAlfa
			? "Esta cor tem transparência. O seletor do sistema não a representa — editando por aqui o alfa se perderia. Use o campo ao lado."
			: "Esta cor não é representável no seletor do sistema (é uma referência ou função). Use o campo ao lado.";

		amostra.addClass("is-sem-seletor");
		amostra.setAttr("aria-label", motivo);
		amostra.setAttr("title", motivo);

		// Clicar mesmo assim é o gesto natural: em vez de nada acontecer, o campo de texto ganha o
		// foco com o valor selecionado — que é o caminho que ela precisava tomar.
		amostra.setAttr("role", "button");
		amostra.setAttr("tabindex", "0");
		amostra.addEventListener("click", () => {
			entradaTexto.focus();
			entradaTexto.select();
		});
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

/**
 * Sombra: prévia grande + uma linha de controles POR CAMADA.
 *
 * Como campo de texto único (o desenho anterior) uma sombra de três camadas era pior de editar do
 * que o CSS cru: 120 caracteres numa linha, onde mexer no desfoque da segunda camada exige contar
 * vírgulas dentro de `rgba()`. Agora cada camada tem sua cor, seu deslocamento e seu desfoque.
 *
 * O campo de texto continua existindo, recolhido: é a saída para o que os controles não alcançam, e
 * a forma de ela conferir exatamente o que vai para o arquivo.
 */
function desenharSombra(pai: HTMLElement, campo: Campo, aoMudar: AoMudar): void {
	const caixa = pai.createDiv({ cls: "ve-controle ve-controle-sombra" });

	let camadas = separarCamadas(campo.valor);

	// A prévia é um bloco de verdade com a sombra aplicada, e não um quadradinho: uma sombra de
	// assentamento (a dela) só se lê num retângulo com alguma área.
	const palco = caixa.createDiv({ cls: "ve-sombra-palco" });
	const previa = palco.createDiv({ cls: "ve-previa-sombra" });
	previa.style.boxShadow = campo.valor;

	const listaEl = caixa.createDiv({ cls: "ve-sombra-camadas" });
	const rodape = caixa.createDiv({ cls: "ve-sombra-rodape" });

	// O texto cru fica recolhido: é escape e conferência, não o caminho principal. Declarado aqui,
	// antes de quem o usa, porque `atualizar` escreve nele a cada gesto.
	const detalhes = caixa.createEl("details", { cls: "ve-sombra-texto" });
	detalhes.createEl("summary", { text: "Ver o valor" });

	const entradaTexto = detalhes.createEl("input", {
		cls: "ve-entrada ve-entrada-cor",
		attr: { type: "text", spellcheck: "false", value: campo.valor },
	});

	/**
	 * A prévia acompanha o gesto, mas o arquivo só é tocado no fim dele.
	 *
	 * `gravar: false` é o que roda no `input` do slider/seletor de cor — mesma regra dos outros
	 * controles, e aqui ela importa ainda mais: uma sombra tem vários controles, e gravar em cada
	 * um dispararia o hot reload dela em rajada.
	 */
	const atualizar = (gravar: boolean) => {
		const texto = sombraParaTexto(camadas);
		previa.style.boxShadow = texto;
		entradaTexto.value = texto;
		if (gravar && texto !== campo.valor) aoMudar(texto);
	};

	const redesenhar = () => {
		listaEl.empty();
		camadas.forEach((camada, indice) => {
			desenharCamadaSombra(listaEl, camada, indice, camadas.length, {
				aoAlterar: atualizar,
				aoRemover: () => {
					// A última camada não é removível: uma sombra sem camada nenhuma teria de virar
					// `none`, que é uma decisão diferente de "ajustar a sombra" — e o campo de texto
					// está logo abaixo para quem quiser fazer isso de propósito.
					if (camadas.length <= 1) return;
					camadas = camadas.filter((_, i) => i !== indice);
					redesenhar();
					atualizar(true);
				},
			});
		});
	};

	const confirmarTexto = () => {
		const novo = entradaTexto.value.trim();
		if (novo === campo.valor) return;
		// Reler as camadas do texto que ela digitou mantém os controles e o texto falando do mesmo
		// valor; sem isto, editar aqui e depois mexer num slider descartaria o que ela escreveu.
		camadas = separarCamadas(novo);
		previa.style.boxShadow = novo;
		redesenhar();
		aoMudar(novo);
	};

	entradaTexto.addEventListener("blur", confirmarTexto);
	entradaTexto.addEventListener("keydown", (evento) => {
		if (evento.key === "Enter") {
			evento.preventDefault();
			entradaTexto.blur();
		}
	});

	const adicionar = rodape.createEl("button", {
		cls: "ve-sombra-adicionar",
		attr: { type: "button" },
	});
	setIcon(adicionar.createSpan({ cls: "ve-sombra-adicionar-icone" }), "plus");
	adicionar.createSpan({ text: "Camada" });
	adicionar.addEventListener("click", () => {
		camadas = [...camadas, camadaPadrao()];
		redesenhar();
		atualizar(true);
	});

	redesenhar();
}

interface AcoesCamada {
	aoAlterar: (gravar: boolean) => void;
	aoRemover: () => void;
}

/**
 * Uma camada: cor, X, Y, desfoque, espalhamento, e o interruptor de sombra interna.
 *
 * Camada que o leitor não decompôs (um `var(--sombra-base)`) aparece como texto travado, com o
 * motivo — em vez de sumir da lista, o que faria a prévia e os controles discordarem.
 */
function desenharCamadaSombra(
	pai: HTMLElement,
	camada: CamadaSombra,
	indice: number,
	total: number,
	acoes: AcoesCamada
): void {
	const linha = pai.createDiv({ cls: "ve-sombra-camada" });

	if (!camada.partes) {
		linha.addClass("is-crua");
		linha.createSpan({ cls: "ve-sombra-crua", text: camada.original });
		linha.setAttr("title", "Esta camada usa uma expressão que a interface não decompõe — ela fica intacta.");
		return;
	}

	const partes = camada.partes;

	// Cor da camada. O seletor nativo não representa alfa, e sombra quase sempre tem alfa — então a
	// amostra abre o seletor só quando o valor é opaco, e o resto vai pelo campo de texto ao lado.
	const cor = partes.cor ?? "currentColor";
	const amostra = linha.createDiv({ cls: "ve-swatch ve-sombra-swatch" });
	amostra.style.background = cor;
	if (corTemAlfa(cor)) amostra.addClass("is-alfa");

	const hex = paraHex(cor, pai.doc);
	if (hex !== null && !corTemAlfa(cor)) {
		const seletor = linha.createEl("input", {
			cls: "ve-seletor-cor",
			attr: { type: "color", value: hex },
		});
		amostra.addClass("is-clicavel");
		amostra.setAttr("role", "button");
		amostra.setAttr("tabindex", "0");
		amostra.setAttr("aria-label", `Cor da camada ${indice + 1}`);
		amostra.addEventListener("click", () => seletor.click());
		amostra.addEventListener("keydown", (evento) => {
			if (evento.key === "Enter" || evento.key === " ") {
				evento.preventDefault();
				seletor.click();
			}
		});
		seletor.addEventListener("input", () => {
			partes.cor = seletor.value;
			amostra.style.background = seletor.value;
			acoes.aoAlterar(false);
		});
		seletor.addEventListener("change", () => {
			partes.cor = seletor.value;
			amostra.style.background = seletor.value;
			acoes.aoAlterar(true);
		});
	} else {
		amostra.setAttr("aria-label", `Cor da camada ${indice + 1} — edite pelo campo ao lado`);
	}

	const entradaCor = linha.createEl("input", {
		cls: "ve-entrada ve-sombra-cor-texto",
		attr: { type: "text", spellcheck: "false", value: partes.cor ?? "" },
	});
	entradaCor.addEventListener("blur", () => {
		const novo = entradaCor.value.trim();
		partes.cor = novo || null;
		amostra.style.background = novo || "currentColor";
		amostra.toggleClass("is-alfa", corTemAlfa(novo));
		acoes.aoAlterar(true);
	});
	entradaCor.addEventListener("keydown", (evento) => {
		if (evento.key === "Enter") {
			evento.preventDefault();
			entradaCor.blur();
		}
	});

	// Os quatro números. Cada um com sua sigla, porque "x/y/desfoque/espalhamento" por extenso não
	// cabe na linha e a sigla é o vocabulário do próprio CSS.
	const numeros = linha.createDiv({ cls: "ve-sombra-numeros" });
	medidaDaCamada(numeros, "X", partes.x, "Deslocamento horizontal", (m) => {
		partes.x = m;
	}, acoes);
	medidaDaCamada(numeros, "Y", partes.y, "Deslocamento vertical", (m) => {
		partes.y = m;
	}, acoes);
	medidaDaCamada(numeros, "Desfoque", partes.desfoque ?? { numero: 0, unidade: "px" }, "Desfoque", (m) => {
		partes.desfoque = m;
	}, acoes);
	medidaDaCamada(
		numeros,
		"Espalh.",
		partes.espalhamento ?? { numero: 0, unidade: "px" },
		"Espalhamento — quanto a sombra cresce ou encolhe antes de desfocar",
		(m) => {
			// Zero é o padrão do CSS: gravar `0px` explicitamente só aumentaria o valor sem mudar nada.
			partes.espalhamento = m.numero === 0 ? null : m;
		},
		acoes
	);

	const acoesEl = linha.createDiv({ cls: "ve-sombra-acoes" });

	const interna = acoesEl.createEl("button", {
		cls: "ve-botao-icone ve-sombra-interna",
		attr: {
			type: "button",
			"aria-label": partes.interna ? "Sombra interna (clique para externa)" : "Sombra externa (clique para interna)",
			"aria-pressed": String(partes.interna),
		},
	});
	setIcon(interna, partes.interna ? "corner-down-right" : "corner-up-right");
	interna.toggleClass("is-ativo", partes.interna);
	interna.addEventListener("click", () => {
		partes.interna = !partes.interna;
		acoes.aoAlterar(true);
	});

	if (total > 1) {
		const remover = acoesEl.createEl("button", {
			cls: "ve-botao-icone ve-sombra-remover",
			attr: { type: "button", "aria-label": `Remover a camada ${indice + 1}` },
		});
		setIcon(remover, "trash-2");
		remover.addEventListener("click", acoes.aoRemover);
	}
}

/** Um número da camada, com a sigla acima. Confirma no blur e no Enter, como os outros campos. */
function medidaDaCamada(
	pai: HTMLElement,
	sigla: string,
	medida: Medida,
	titulo: string,
	aplicar: (medida: Medida) => void,
	acoes: AcoesCamada
): void {
	const bloco = pai.createDiv({ cls: "ve-sombra-medida" });
	bloco.setAttr("title", titulo);
	bloco.createSpan({ cls: "ve-sombra-sigla", text: sigla });

	const entrada = bloco.createEl("input", {
		cls: "ve-entrada ve-sombra-numero",
		attr: { type: "number", step: "1", value: String(medida.numero) },
	});

	const confirmar = () => {
		const bruto = entrada.value.trim();
		if (bruto === "") return;
		const numero = parseFloat(bruto);
		if (Number.isNaN(numero)) return;
		// A unidade original é preservada: um `0.5rem` continua em `rem` depois de ela digitar 0,8.
		// A exceção é o zero sem unidade — passar a valer 4 exige uma unidade, e `px` é a do CSS.
		aplicar({ numero, unidade: medida.unidade || (numero === 0 ? "" : "px") });
		acoes.aoAlterar(true);
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
