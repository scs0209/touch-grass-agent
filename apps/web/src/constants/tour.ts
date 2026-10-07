import type { TourId, TourStep } from '../types/tour';

/** Shown once each: the home tour after the questionnaire, the result tour on the first suggestion. */
export const TOURS: Record<TourId, TourStep[]> = {
  home: [
    {
      target: 'minutes',
      title: 'How much time do you have?',
      body: 'Every suggestion fits the way there and back into this.',
    },
    {
      target: 'here',
      title: 'One suggestion',
      body: 'Gemma, running locally, checks the weather, the air, and the parks near you, and picks one place.',
    },
    {
      target: 'city',
      title: 'Or somewhere else',
      body: "Type a city to see what's good there.",
    },
    {
      target: 'explorations',
      title: 'Your explorations',
      body: 'This only fills up when you check in on site. Going somewhere is the only way to move the goals.',
    },
  ],
  result: [
    {
      target: 'preview',
      title: 'See it first',
      body: 'Watch the walk as a short 3D flyover of the real streets.',
    },
    {
      target: 'directions',
      title: 'Then go',
      body: 'Open the directions and put your phone in your pocket.',
    },
    {
      target: 'check-in',
      title: 'Check in when you arrive',
      body: "Tap “I'm here” at the place. Your location is compared on this device and isn't sent or saved.",
    },
  ],
};
