export type TourId = 'home' | 'result';

export interface TourStep {
  /** The data-tour value of the element the step points at; steps whose element isn't on screen are skipped. */
  target: string;
  title: string;
  body: string;
}

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}
