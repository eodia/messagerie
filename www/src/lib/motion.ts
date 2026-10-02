/**
 * What the home page's scenes share: a drawing made at a fixed size and scaled to its
 * frame, the progress of a section through the screen, and a play that runs only while
 * its section is on screen. Browser-only: imported by the components' scripts.
 */

export const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const clamp = (value: number, low = 0, high = 1): number => Math.min(high, Math.max(low, value));

/** Slow at both ends. */
export const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Scales a drawing made at `width` pixels to its frame's width, never below `min`: sets
 * `--k` on the frame, and keeps it right when the frame resizes. A drawing that changes
 * its width with the screen gives it as a function.
 */
export function fit(frame: HTMLElement, width: number | (() => number), min = 0.3): void {
	const drawn = typeof width === 'number' ? () => width : width;
	const apply = () => frame.style.setProperty('--k', String(Math.min(1, Math.max(min, frame.clientWidth / drawn()))));
	apply();
	new ResizeObserver(apply).observe(frame);
}

/**
 * Calls `update` with the progress of `section` on every frame the page scrolls while it
 * is near the screen.
 *
 * - `pin`: a tall section whose content stays pinned — 0 when its top reaches the top of
 *   the screen, 1 when its bottom reaches the bottom.
 * - `pass`: an element going by — 0 when its top reaches `start` (a fraction of the
 *   screen's height, from the top), 1 when its bottom reaches `end`.
 */
export function progress(
	section: HTMLElement,
	update: (p: number) => void,
	options: { mode: 'pin' } | { mode: 'pass'; start: number; end: number } = { mode: 'pin' },
): void {
	let frame = 0;
	let near = false;
	const measure = () => {
		frame = 0;
		const box = section.getBoundingClientRect();
		const vh = window.innerHeight;
		if (options.mode === 'pin') {
			update(clamp(-box.top / Math.max(1, box.height - vh)));
		} else {
			const from = vh * options.start;
			const span = from - (vh * options.end - box.height);
			update(clamp((from - box.top) / Math.max(1, span)));
		}
	};
	const request = () => {
		if (near && frame === 0) frame = requestAnimationFrame(measure);
	};
	new IntersectionObserver(
		([entry]) => {
			near = entry?.isIntersecting === true;
			request();
		},
		{ rootMargin: '50% 0px 50% 0px' },
	).observe(section);
	window.addEventListener('scroll', request, { passive: true });
	window.addEventListener('resize', request);
	measure();
}

/**
 * Runs `play` while `section` is on screen, and stops it when it leaves. `play` receives
 * a `sleep` that never resolves once stopped, so a loop simply goes quiet; it starts
 * again from the beginning when the section comes back. The function returned starts it
 * again from the beginning at once, if the section is on screen.
 */
export function whileVisible(
	section: HTMLElement,
	play: (sleep: (ms: number) => Promise<void>) => Promise<void>,
	threshold = 0.3,
): () => void {
	let run = 0;
	let shown = false;
	const start = () => {
		run += 1;
		if (!shown) return;
		const mine = run;
		const sleep = (ms: number) =>
			new Promise<void>((resolve) => {
				setTimeout(() => {
					if (run === mine) resolve();
				}, ms);
			});
		void play(sleep);
	};
	new IntersectionObserver(
		([entry]) => {
			shown = entry?.isIntersecting === true;
			start();
		},
		{ threshold },
	).observe(section);
	return start;
}
