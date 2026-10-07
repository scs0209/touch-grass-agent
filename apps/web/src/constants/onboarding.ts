/** The loop the app is built around, shown once above the first questionnaire. */
export const ONBOARDING_STEPS = [
  { icon: '🌤️', text: 'Gemma, running locally, picks one place from the weather, the air, and the parks near you.' },
  { icon: '🎬', text: 'Watch a short 3D preview of the walk, if you like.' },
  { icon: '🚶', text: 'Go there, and leave your phone in your pocket.' },
  { icon: '📍', text: "Tap “I'm here” when you arrive. New places count toward a few small goals." },
];

/** Only the check-in stays on the device; finding places does send the starting point to map services. */
export const ONBOARDING_PRIVACY =
  "Checking in compares your location with the place on this device; it isn't sent or saved.";
