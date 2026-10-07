import type { PlaceKind } from '../types/api';
import type { ExploreStats } from '../types/explore';
import type { Bottom, Extra, Fit, Outer, Top } from '../types/outfit';
import type { Company, Interest, Pace } from '../types/preferences';
import type { TourStepId } from '../types/tour';
import type { AirLevel } from '../types/weather';

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function duration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours} h ${rest} min` : `${rest} min`;
}

export const en = {
  locale: 'en-US',
  /** The switch shows the language it changes to, written in that language. */
  otherLanguage: '한국어',
  switchLanguage: 'Switch to Korean',
  duration,
  hereLabel: 'your location',

  home: {
    title: 'Should I go out?',
    editAnswers: 'Edit answers',
    timeQuestion: 'How much time do you have?',
    minutes: (minutes: number) => `${minutes} min`,
    minutesSlider: 'Available minutes',
    checkHere: 'Check right here',
    cityPlaceholder: 'or type a city, e.g. Seoul',
    go: 'Go',
    howItWorks: 'How it works',
  },

  loading: {
    locating: 'Finding where you are…',
    lookingUp: (city: string) => `Looking up ${city}…`,
    checkingBikes: 'Checking the sky, the air, and nearby bikes…',
    checkingPlaces: 'Checking the sky, the air, and nearby places…',
  },

  errors: {
    location: {
      1: 'Location access is blocked. Allow it in your browser settings, or type your city.',
      2: "Your device couldn't work out where you are. Check that Location Services is on for this browser, or type your city.",
      3: 'Finding your location took too long. Check that Location Services is on for this browser, or type your city.',
    } as Record<number, string>,
    locationOther: "Couldn't get your location. Type your city instead.",
    checkInBlocked: 'Checking in needs your location. Allow it for this site in your browser settings and try again.',
    checkInFailed: "Couldn't get your location just now. Try again in a moment, ideally out in the open.",
    cityNotFound: (name: string) => `Couldn't find "${name}".`,
    unreachable:
      "Couldn't reach the app's server. On your phone, check that the Mac is awake and online. Checking in still works offline.",
    invalidRequest: "The server couldn't read this location or your answers. Try again.",
    server: 'Could not check the conditions right now. Try again in a minute.',
    noOtherPlaces: (minutes: number, around: string) =>
      `No other places fit in ${minutes} minutes around ${around}. Try more time to reach farther ones.`,
  },

  questionnaire: {
    title: 'What do you like?',
    intro: 'A few quick picks help the suggestions fit you. Skip any question you like.',
    skip: 'Skip and let the AI decide everything',
    pace: 'How do you like to move?',
    interests: 'What do you enjoy?',
    interestsHint: 'Pick as many as you like.',
    company: 'Who usually comes along?',
    cycling: 'Public bikes?',
    cyclingHint: 'Rides are suggested only if you pick yes (Seoul, 30 minutes or more). Otherwise you walk.',
    save: 'Save my picks',
  },

  preferences: {
    pace: { easy: 'Easy and relaxed', active: 'A bit active', workout: 'Get my heart rate up' } as Record<Pace, string>,
    interests: {
      greenery: 'Greenery',
      quiet: 'Quiet spots',
      views: 'Views and photos',
      exercise: 'Exercise',
      water: 'Water',
    } as Record<Interest, string>,
    company: { alone: 'Just me', kids: 'With kids', dog: 'With a dog', friends: 'With friends' } as Record<
      Company,
      string
    >,
    cycling: { yes: 'Happy to ride a bike', no: 'Walking only' },
    ai: 'The AI decides everything',
    none: 'No preferences picked',
  },

  checkIn: {
    title: 'Out exploring?',
    body: (names: string) =>
      `Made it to ${names}? Check in to add it to your explorations. Your location is only compared on this device.`,
    compactBody: (names: string) => `At ${names}? Check in to add it to your explorations.`,
    button: "📍 I'm here",
    locating: 'Checking where you are…',
    far: (distance: string, place: string) => `You're about ${distance} from ${place}. Check in once you're there.`,
    madeIt: 'You made it.',
    nowThatYoureHere: "Now that you're here",
    newBadge: 'New badge:',
    putPhoneAway: 'Put my phone away',
    namesTwo: (first: string, second: string) => `${first} or ${second}`,
    namesMany: (first: string, others: number) => `${first} or ${others} other places`,
  },

  explore: {
    title: 'Your explorations',
    empty: 'Check in when you reach a suggested place and it shows up here. Nothing leaves this device.',
    thisWeek: 'This week',
    lastWeek: 'Last week',
    bestWeek: 'Best week',
    badgesLabel: 'Badges',
    recentLabel: 'Recently explored',
    /** E.g. "4 places · 2 cities · 3 weeks in a row"; a streak counts once it is two weeks long. */
    stats: ({ places, cities, weekStreak }: Pick<ExploreStats, 'places' | 'cities' | 'weekStreak'>) =>
      [
        plural(places, 'place', 'places'),
        plural(cities, 'city', 'cities'),
        ...(weekStreak >= 2 ? [`${weekStreak} weeks in a row`] : []),
      ].join(' · '),
    missions: {
      today: "Explore one of today's suggestions",
      week: (goal: number) => `Explore ${goal} new places this week`,
      city: (goal: number) => `Find ${goal} different places in one city`,
      cities: 'Explore a second city',
      kinds: 'Explore both a park and a landmark',
    },
    badges: {
      first: 'First steps',
      firstDetail: (name: string) => `First check-in at ${name}`,
      five: 'Five places',
      fiveDetail: '5 different places explored',
      ten: 'Ten places',
      tenDetail: '10 different places explored',
      kinds: 'Park and landmark',
      kindsDetail: 'Explored both a park and a landmark',
      local: 'Local explorer',
      localDetail: (goal: number, city: string) => `${goal} different places in ${city}`,
      cities: 'Two cities',
      streak: (weeks: number) => `${weeks} weeks in a row`,
      streakDetail: (weeks: number) => `Out exploring ${weeks} weeks running`,
    },
    discovery: {
      first: 'Your first exploration',
      firstKind: (kind: PlaceKind) => `Your first ${kind}`,
      firstIn: (city: string) => `First place in ${city}`,
      new: 'New place for you',
    },
    backAgain: 'Back again',
    backAgainSince: (date: string) => `Back again · last here ${date}`,
    exploredOn: (date: string) => `You explored this on ${date}`,
    missionNote: (discovery: string, completes: boolean, mission: string) =>
      `${discovery} · ${completes ? 'completes' : 'counts toward'} “${mission}”`,
  },

  places: {
    kind: { park: 'Park', landmark: 'Landmark' } as Record<PlaceKind, string>,
    from: (distance: string, origin: string) => `${distance} from ${origin}`,
  },

  recent: {
    title: 'Recent places',
    empty: 'Places you get suggested show up here, so you can pick one again later.',
    remove: (name: string) => `Remove ${name} from recent places`,
  },

  result: {
    go: 'Go outside.',
    stay: 'Maybe stay in for now.',
    minutes: (minutes: number) => `${minutes} minutes`,
    onceThere: "Once you're there",
    notFeelingIt: (around: string) => `Not feeling it? Try somewhere else around ${around}.`,
    finding: 'Finding another place…',
    another: '↻ Another place',
    preview: (byBike: boolean) => `▶ Preview your ${byBike ? 'ride' : 'walk'}`,
    wear: 'What to wear',
    fit: { cold: 'Runs cold', normal: 'Just right', warm: 'Runs warm' } as Record<Fit, string>,
    directions: (byBike: boolean, name: string) => `${byBike ? 'Ride' : 'Walk'} to ${name}`,
    pocket: 'Now put your phone in your pocket.',
    askAgain: 'Ask again',
    byModel: 'Suggested by Gemma running locally',
    byRules: 'Rule-based suggestion (model unavailable)',
    /** The line under the map, e.g. "1.3 km round trip to X · about 18 min on foot". */
    routeWalk: (km: string, place: string, minutes: number) =>
      `${km} km round trip to ${place} · about ${minutes} min on foot`,
    routeBike: (km: string, place: string, minutes: number, rideMin: number, station: string, walkMin: number) =>
      `${km} km round trip to ${place} · about ${minutes} min (${rideMin} by bike from ${station}, ${walkMin} on foot)`,
    theStation: 'the station',
  },

  map: {
    full: '⤢ Full map',
    fullLabel: 'Show the map full screen',
    dialog: (place: string) => `Map to ${place}`,
    yourDestination: 'your destination',
    close: 'Close the full map',
    youAreHere: 'You are here',
  },

  weather: {
    feelsLike: (degrees: number) => `Feels like ${degrees}°`,
    rain: 'Rain',
    now: 'Now',
    air: 'Air',
    index: (value: number) => `Index ${value}`,
    uv: 'UV',
    wind: 'Wind',
    sunsetIn: (time: string, left: string) => `Sunset ${time} · in ${left}`,
    sunSet: (time: string) => `The sun set at ${time}`,
    uvLevels: ['Low', 'Moderate', 'High', 'Very high', 'Extreme'],
    windLevels: ['Calm', 'Light breeze', 'Breezy', 'Strong wind', 'Gale'],
    airLevels: {
      good: 'good',
      fair: 'fair',
      moderate: 'moderate',
      poor: 'poor',
      'very poor': 'very poor',
      'extremely poor': 'extremely poor',
    } as Record<AirLevel, string>,
    /** The server describes the sky in English, e.g. "partly cloudy". */
    describe: (description: string) => description,
  },

  outfit: {
    items: {
      tshirt: 'T-shirt',
      longsleeve: 'Long-sleeve tee',
      knit: 'Knit sweater',
      hoodie: 'Hoodie',
      shorts: 'Shorts',
      pants: 'Long pants',
      none: 'No outer layer',
      light_jacket: 'Light jacket',
      trench: 'Trench coat',
      coat: 'Wool coat',
      padded: 'Puffer jacket',
      umbrella: 'Umbrella',
      mask: 'Mask',
      cap: 'Cap',
      sunglasses: 'Sunglasses',
      scarf: 'Scarf',
      gloves: 'Gloves',
    } as Record<Top | Bottom | Outer | Extra, string>,
    avatar: 'Avatar wearing the suggested outfit',
  },

  tour: {
    steps: {
      minutes: {
        title: 'How much time do you have?',
        body: 'Every suggestion fits the way there and back into this.',
      },
      here: {
        title: 'One suggestion',
        body: 'Gemma, running locally, checks the weather, the air, and the parks near you, and picks one place.',
      },
      city: { title: 'Or somewhere else', body: "Type a city to see what's good there." },
      explorations: {
        title: 'Your explorations',
        body: 'This only fills up when you check in on site. Going somewhere is the only way to move the goals.',
      },
      preview: { title: 'See it first', body: 'Watch the walk as a short 3D flyover of the real streets.' },
      directions: { title: 'Then go', body: 'Open the directions and put your phone in your pocket.' },
      'check-in': {
        title: 'Check in when you arrive',
        body: "Tap “I'm here” at the place. Your location is compared on this device and isn't sent or saved.",
      },
    } as Record<TourStepId, { title: string; body: string }>,
    skip: 'Skip',
    back: 'Back',
    next: 'Next',
    done: 'Done',
  },

  phone: {
    link: 'Use it on your phone',
    title: 'Take it outside',
    close: 'Close',
    body: 'Gemma runs on this computer. To use the app on your phone outside, connect the two with Tailscale, which is free for personal use. Checking in works on the phone even without a signal.',
    installBefore: 'Install ',
    installAfter: ' on this computer and your phone, signed in to the same account.',
    runBefore: 'Run ',
    runBetween: ', then ',
    runAfter: '.',
    openBefore: 'Open the ',
    openAfter: ' address it prints on your phone.',
    fullSteps: 'Full setup steps',
  },

  preview: {
    dialog: (byBike: boolean, place: string) => `Preview of your ${byBike ? 'ride' : 'walk'} to ${place}`,
    mute: 'Mute music',
    close: 'Close preview',
    loading: 'Getting your walk ready…',
    error: "Couldn't load the preview.",
    play: '▶ Play with music',
    replay: 'Replay',
    save: 'Save video',
    share: 'Share',
    shareTitle: (place: string) => `My walk to ${place}`,
  },

  /** Words drawn into the walk preview video. */
  film: {
    /** How long a caption stays up: on-screen reading speed in characters per second. */
    readCharsPerSec: 13,
    byBike: (station: string) => `By bike from ${station}`,
    onFoot: 'On foot',
    onTheWay: (place: string) => `On the way to ${place}`,
    wayThere: (km: string | null, minutes: number) =>
      km ? `${km} km · about ${minutes} min there` : `About ${minutes} min there`,
    mapCredit: (credit: string) => `Map: ${credit}`,
    andOthers: (names: string[]) => `${names.join(', ')} and others`,
    mapillaryCredit: (names: string) => `Photos: ${names} on Mapillary, CC BY-SA 4.0`,
    commonsCredit: (creator: string, license: string) => `Photo: ${creator}, ${license}, via Wikimedia Commons`,
    rightNow: (degrees: number, sky: string) => `${degrees}° · ${sky} right now`,
    nextMinutes: (minutes: number) => `Your next ${minutes} minutes`,
    dressFor: (degrees: number, items: string[]) => `Dress for ${degrees}°: ${items.join(', ')}`,
    arrived: "You've arrived",
    onceThere: "Once you're there",
    onceThereCount: (index: number, count: number) => `Once you're there · ${index}/${count}`,
    ready: 'Ready when you are.',
    leaveNow: 'Leave now',
    backBy: (time: string) => `Back by ${time}`,
    sunset: (time: string) => `Sunset ${time}`,
  },

  /** Words drawn into the illustrated story, shown when the 3D map can't load. */
  story: {
    sky: (degrees: number, sky: string) => `${degrees}° · ${sky}`,
    dressFor: (degrees: number) => `Dress for ${degrees}°`,
    goTo: (byBike: boolean, place: string) => `${byBike ? 'Ride' : 'Walk'} to ${place}`,
    km: (km: string) => `${km} km`,
    roundTrip: 'round trip',
    roundTripBike: (station: string) => `round trip · bike from ${station}`,
    progress: (km: string, minutes: number) => `${km} km · ${minutes} min`,
    rideAndWalk: (rideMin: number, station: string, walkMin: number) =>
      `${rideMin} min by bike from ${station}, ${walkMin} on foot`,
    roundTripOnFoot: 'round trip on foot',
    madeIt: 'You made it.',
    leaveNowBackBy: (time: string) => `Leave now · back by ${time}`,
    sunsetAt: (time: string) => `Sunset at ${time}`,
  },
};

export type Messages = typeof en;
