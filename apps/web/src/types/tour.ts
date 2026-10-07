export type TourId = 'home' | 'result';

/** The data-tour value of the element a step points at; steps whose element isn't on screen are skipped. */
export type TourStepId = 'minutes' | 'here' | 'city' | 'explorations' | 'preview' | 'directions' | 'check-in';

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}
