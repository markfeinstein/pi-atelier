import { copyToClipboard, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { formatErrorText } from "./error-text.js";

interface PromptMouseEvent {
	type: string;
	button: string;
	clickCount?: number;
	shift: boolean;
	alt: boolean;
	ctrl: boolean;
}

interface PromptMouseResult {
	handled?: boolean;
	render?: boolean;
}

type PromptMouseHandler = (this: object, event: PromptMouseEvent) => PromptMouseResult | undefined;
type MouseCapablePrototype = object & { handleMouse?: PromptMouseHandler };

/**
 * Copy a complete original user prompt on an unmodified fullscreen click.
 *
 * Pi introduced component mouse dispatch after Atelier's 0.84 compatibility floor. Installing the
 * method is therefore inert on older Pi versions and becomes active when the host dispatches clicks.
 */
export function installUserPromptCopy(
	notify: (message: string, kind: "info" | "error") => void,
	isFullscreen: () => boolean,
): () => void {
	const prototype = UserMessageComponent.prototype as unknown as MouseCapablePrototype;
	const previous = prototype.handleMouse;
	const descriptor = Object.getOwnPropertyDescriptor(prototype, "handleMouse");
	let disposed = false;

	function handleMouse(this: object, event: PromptMouseEvent): PromptMouseResult | undefined {
		const result = previous?.call(this, event);
		if (
			result !== undefined ||
			disposed ||
			!isFullscreen() ||
			event.type !== "click" ||
			event.button !== "left" ||
			(event.clickCount ?? 1) !== 1 ||
			event.shift ||
			event.alt ||
			event.ctrl
		) {
			return result;
		}
		const text: unknown = Reflect.get(this, "text");
		if (typeof text !== "string" || text.length === 0) return result;
		void copyToClipboard(text).then(
			() => {
				if (!disposed) notify("User prompt copied", "info");
			},
			(error: unknown) => {
				if (!disposed) notify(`Could not copy user prompt: ${formatErrorText(error)}`, "error");
			},
		);
		return { handled: true, render: false };
	}

	prototype.handleMouse = handleMouse;
	return () => {
		disposed = true;
		if (prototype.handleMouse !== handleMouse) return;
		if (descriptor) Object.defineProperty(prototype, "handleMouse", descriptor);
		else delete prototype.handleMouse;
	};
}
