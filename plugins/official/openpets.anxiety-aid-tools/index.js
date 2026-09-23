// Anxiety Aid Tools (openpets.anxiety-aid-tools) — SDK v3 calm practices.
//
// The OpenPets companion of https://anxietyaidtools.com/. Supports simple
// breathing (Calm 4-6), guided breathing (box, 4-7-8, energizing, quick
// reset), progressive muscle relaxation (PMR), and 5-4-3-2-1 grounding: the host
// renders the session overlay (night-sky orb, step track, bottom card) around
// the pet and a dedicated Info window from the declarative descriptor below;
// this plugin owns patterns and steps, the localized knowledge layer (how it
// works, the science with linked studies, tips), and practice switching.

export const SITE_URL = "https://anxietyaidtools.com/";


export const STORAGE_KEY_AUDIO_CUES = "audioCues";
export const STORAGE_KEY_LAST_GUIDED_PATTERN = "lastGuidedPattern";
export const STORAGE_KEY_LAST_MEDITATION = "lastMeditation";
export const STORAGE_KEY_LAST_VISUALIZATION = "lastVisualization";
export const STORAGE_KEY_LAST_SOUNDSCAPE = "lastSoundscape";

export const PRACTICE_IDS = ["breathing", "guided-breathing", "pmr", "grounding", "meditation", "visualization", "sounds"];

/** Narration lives on AAT's R2; the host downloads and caches each segment. */
export const MEDIA_ORIGIN = "https://r2.anxietyaidtools.com";

/** AAT guided meditation sessions, grouped as on the website. */
export const MEDITATION_SESSIONS = [
  { id: "physiological-sigh-reset", category: "anxiety", group: "grounded", segments: 7 },
  { id: "structural-realignment-protocol", category: "anxiety", group: "grounded", segments: 13 },
  { id: "vagus-nerve-delta-descent", category: "sleep", group: "grounded", segments: 14 },
  { id: "kinetic-grounding-sequence", category: "walking", group: "grounded", segments: 10 },
  { id: "hypnagogic-induction-sequence", category: "sleep", group: "grounded", segments: 13 },
  { id: "oceanic-consciousness-projection", category: "mindfulness", group: "spiritual", segments: 12 },
  { id: "infinite-horizon-projection", category: "mindfulness", group: "spiritual", segments: 11 },
  { id: "metta-loving-kindness-protocol", category: "mindfulness", group: "spiritual", segments: 12 },
];
export const MEDITATION_IDS = MEDITATION_SESSIONS.map((session) => session.id);

/** AAT peaceful visualization scenes; each is seven narrated steps. */
export const VISUALIZATION_SCENES = [
  "mountainPeakSunrise",
  "tranquilForestGrove",
  "peacefulOceanBeach",
  "sereneGardenParadise",
  "starlitMeadowNight",
  "cozyRainyCabin",
  "mistyLakesideDawn",
  "sunlitDesertOasis",
  "floatingCloudSanctuary",
];
const VISUALIZATION_STEPS = 7;

/**
 * AAT records narration in en, es, pt, and zh (and languages OpenPets does not
 * ship). Other host locales hear English with translated captions.
 */
// Relaxing sounds scenes, converted from Anxiety Aid Tools
// data/environments/*.json: each layer is a looping bed or an accent on an
// interval. Files stream from r2.anxietyaidtools.com through the host media
// cache and the host mixes them (soundscape session kind). The plugin entry
// loads as a single module, so the data lives here.
export const SOUNDSCAPES = [
  {
    "id": "ocean-beach",
    "categories": [
      "anxiety",
      "sleep"
    ],
    "layers": [
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/61773279-8067-45d4-af26-ef577830af64.mp3"
        ],
        "volume": 0.55,
        "loop": true,
        "fadeIn": 0.5,
        "crossfade": 3
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/343315ce-1807-4bd9-a4e6-a07485538635.mp3"
        ],
        "volume": 0.4,
        "loop": true,
        "fadeIn": 1,
        "crossfade": 2.5,
        "pan": {
          "min": 0.3,
          "max": 0.7
        }
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/ed5245b8-5809-4a0d-a4e5-0327ccf68e63.mp3"
        ],
        "volume": {
          "min": 0.35,
          "max": 0.5
        },
        "interval": {
          "type": "wave",
          "min": 20,
          "max": 60,
          "increment": 5
        },
        "fadeIn": 1.5,
        "fadeOut": 2,
        "duration": 45,
        "pan": {
          "min": 0.2,
          "max": 0.8
        }
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/83c64d41-d43b-4957-9e32-aafc803bf85f.mp3"
        ],
        "volume": {
          "min": 0.25,
          "max": 0.45
        },
        "interval": {
          "type": "random",
          "min": 10,
          "max": 35
        },
        "fadeIn": 0.3,
        "fadeOut": 1,
        "pan": {
          "min": 0.1,
          "max": 0.9
        },
        "pitch": {
          "min": 0.96,
          "max": 1.04
        }
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/ae7157eb-4b5a-40e2-baf3-69c00fcd3e70.mp3"
        ],
        "volume": {
          "min": 0.3,
          "max": 0.5
        },
        "interval": {
          "type": "random",
          "min": 45,
          "max": 120
        },
        "fadeIn": 0.5,
        "fadeOut": 1.5,
        "pan": {
          "min": 0.0,
          "max": 1.0
        },
        "pitch": {
          "min": 0.94,
          "max": 1.06
        }
      }
    ]
  },
  {
    "id": "rain-on-tent",
    "categories": [
      "sleep",
      "anxiety"
    ],
    "layers": [
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/a95fd9f6-7bf2-4078-bc93-19dd8ce8ea5a.mp3"
        ],
        "volume": 0.65,
        "loop": true,
        "fadeIn": 1.5,
        "crossfade": 3
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/24a55bad-4663-46c4-a7ab-22353456d439.mp3"
        ],
        "volume": {
          "min": 0.6,
          "max": 0.8
        },
        "interval": {
          "type": "random",
          "min": 12,
          "max": 35
        },
        "fadeIn": 1,
        "fadeOut": 1,
        "pan": {
          "min": 0.3,
          "max": 0.7
        }
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/18ac8798-b9ca-4ac2-9165-b263bbc597bb.mp3"
        ],
        "volume": {
          "min": 0.35,
          "max": 0.55
        },
        "interval": {
          "type": "wave",
          "min": 25,
          "max": 80,
          "increment": 10
        },
        "fadeIn": 3,
        "fadeOut": 3,
        "pan": {
          "min": 0.1,
          "max": 0.9
        }
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/0ad7113c-893c-49ae-8165-7bcf937e2dac.mp3"
        ],
        "volume": {
          "min": 0.5,
          "max": 0.75
        },
        "interval": {
          "type": "random",
          "min": 35,
          "max": 110
        },
        "fadeIn": 1.5,
        "fadeOut": 2,
        "pan": {
          "min": 0.2,
          "max": 0.8
        }
      }
    ]
  },
  {
    "id": "fireplace",
    "categories": [
      "anxiety",
      "sleep"
    ],
    "layers": [
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/88d63480-9470-475f-b8b7-c915731a670d.mp3"
        ],
        "volume": 0.55,
        "loop": true,
        "fadeIn": 1.0,
        "crossfade": 3
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/9d4244ef-6533-4d54-8729-e5f9814e39fd.mp3"
        ],
        "volume": {
          "min": 0.6,
          "max": 0.85
        },
        "interval": {
          "type": "random",
          "min": 8,
          "max": 20
        },
        "fadeIn": 0.1,
        "fadeOut": 0.5,
        "pan": {
          "min": 0.2,
          "max": 0.8
        },
        "pitch": {
          "min": 0.98,
          "max": 1.05
        }
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/07151291-9e4d-48e3-baf6-00ea1a9fe9fe.mp3"
        ],
        "volume": {
          "min": 0.5,
          "max": 0.75
        },
        "interval": {
          "type": "random",
          "min": 25,
          "max": 60
        },
        "fadeIn": 0.2,
        "fadeOut": 1.0,
        "pan": {
          "min": 0.1,
          "max": 0.9
        }
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/1dfd3741-48b4-49c9-b79d-d52f030e0386.mp3"
        ],
        "volume": {
          "min": 0.45,
          "max": 0.65
        },
        "interval": {
          "type": "random",
          "min": 45,
          "max": 120
        },
        "fadeIn": 0.5,
        "fadeOut": 1.5,
        "pan": {
          "min": 0.3,
          "max": 0.7
        }
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/88d63480-9470-475f-b8b7-c915731a670d.mp3"
        ],
        "volume": 0.3,
        "loop": true,
        "fadeIn": 2.0,
        "crossfade": 5,
        "pan": {
          "min": 0.0,
          "max": 1.0
        },
        "pitch": {
          "min": 0.9,
          "max": 0.95
        }
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/07151291-9e4d-48e3-baf6-00ea1a9fe9fe.mp3"
        ],
        "volume": {
          "min": 0.3,
          "max": 0.5
        },
        "interval": {
          "type": "random",
          "min": 60,
          "max": 150
        },
        "fadeIn": 2.5,
        "fadeOut": 2.5,
        "duration": 40,
        "pan": {
          "min": 0.4,
          "max": 0.6
        }
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/9f6df7b3-db9c-4600-8024-5a942d93279b.mp3"
        ],
        "volume": {
          "min": 0.45,
          "max": 0.65
        },
        "interval": {
          "type": "random",
          "min": 20,
          "max": 50
        },
        "fadeIn": 1.0,
        "fadeOut": 1.5,
        "pan": {
          "min": 0.3,
          "max": 0.7
        },
        "pitch": {
          "min": 0.95,
          "max": 1.05
        }
      }
    ]
  },
  {
    "id": "japanese-garden",
    "categories": [
      "meditation",
      "focus"
    ],
    "layers": [
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/21b167a7-f199-4557-bfb5-a2fa71414bc9.mp3"
        ],
        "volume": 0.45,
        "loop": true,
        "fadeIn": 1.5,
        "crossfade": 4
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/0cba3d37-162a-4389-a9af-a76dd74a6b7b.mp3"
        ],
        "volume": 0.55,
        "loop": true,
        "fadeIn": 2,
        "crossfade": 3,
        "pan": {
          "min": 0.3,
          "max": 0.7
        }
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/19a6d768-847a-49d5-bc1b-85f2d5722d28.mp3"
        ],
        "volume": {
          "min": 0.3,
          "max": 0.45
        },
        "interval": {
          "type": "wave",
          "min": 20,
          "max": 60,
          "increment": 5
        },
        "fadeIn": 3,
        "fadeOut": 4,
        "duration": 45,
        "pan": {
          "min": 0.15,
          "max": 0.85
        }
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/e3739f47-63fb-4f84-8341-5d3853bf7e15.mp3"
        ],
        "volume": {
          "min": 0.35,
          "max": 0.5
        },
        "interval": {
          "type": "random",
          "min": 8,
          "max": 25
        },
        "fadeIn": 0.8,
        "fadeOut": 1.5,
        "pan": {
          "min": 0.2,
          "max": 0.8
        },
        "pitch": {
          "min": 0.98,
          "max": 1.02
        }
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/1d48e2af-f26f-46c2-b416-9ac975baead0.mp3"
        ],
        "volume": {
          "min": 0.25,
          "max": 0.4
        },
        "interval": {
          "type": "random",
          "min": 35,
          "max": 90
        },
        "fadeIn": 0.5,
        "fadeOut": 2,
        "pan": {
          "min": 0.1,
          "max": 0.9
        },
        "pitch": {
          "min": 0.96,
          "max": 1.04
        }
      }
    ]
  },
  {
    "id": "night-cricket-rain",
    "categories": [
      "sleep",
      "meditation"
    ],
    "layers": [
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/a83bb1e2-bbcb-4796-bb3b-935bbbf0c071.mp3"
        ],
        "volume": 0.6,
        "loop": true,
        "crossfade": 6
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/44b24194-443d-4d19-982a-7bd372b0518c.mp3",
          "https://r2.anxietyaidtools.com/custom/ba8211e0-c020-4601-8e0f-44994510f4e1.mp3"
        ],
        "volume": {
          "min": 0.3,
          "max": 0.5
        },
        "interval": {
          "type": "random",
          "min": 8,
          "max": 35
        },
        "fadeIn": 0.3,
        "fadeOut": 0.5,
        "pan": {
          "min": 0.2,
          "max": 0.8
        },
        "pitch": {
          "min": 0.95,
          "max": 1.05
        }
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/4aa6b9fc-1c49-4d4a-b66f-6a43460f1f76.mp3"
        ],
        "volume": {
          "min": 0.45,
          "max": 0.65
        },
        "interval": {
          "type": "random",
          "min": 25,
          "max": 70
        },
        "fadeIn": 0.2,
        "fadeOut": 0.4,
        "pan": {
          "min": 0.1,
          "max": 0.9
        },
        "pitch": {
          "min": 0.97,
          "max": 1.03
        }
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/b69c51e3-4865-41f9-99a2-0ef7f1afde0c.mp3"
        ],
        "volume": {
          "min": 0.3,
          "max": 0.5
        },
        "interval": {
          "type": "random",
          "min": 45,
          "max": 120
        },
        "fadeIn": 0.5,
        "fadeOut": 1.5,
        "pan": {
          "min": 0.15,
          "max": 0.85
        }
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/ee807fb4-74b4-494c-8e9e-a0602b51d733.mp3"
        ],
        "volume": {
          "min": 0.35,
          "max": 0.5
        },
        "interval": {
          "type": "random",
          "min": 90,
          "max": 200
        },
        "fadeIn": 0.3,
        "fadeOut": 0.8,
        "pan": {
          "min": 0.0,
          "max": 1.0
        },
        "pitch": {
          "min": 0.96,
          "max": 1.04
        }
      }
    ]
  },
  {
    "id": "rainy-cafe",
    "categories": [
      "focus",
      "anxiety"
    ],
    "layers": [
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/353f3e21-5596-4bde-9395-5d7eff7cb8e3.mp3"
        ],
        "volume": 0.45,
        "loop": true,
        "fadeIn": 1,
        "crossfade": 3
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/d42d6985-ed79-47c6-b332-880c0d50c266.mp3"
        ],
        "volume": 1.0,
        "loop": true,
        "fadeIn": 0.5,
        "crossfade": 2.5
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/45b6f435-6de3-4f78-901d-3b8ed2fa44ab.mp3"
        ],
        "volume": {
          "min": 0.5,
          "max": 0.75
        },
        "interval": {
          "type": "random",
          "min": 15,
          "max": 45
        },
        "fadeIn": 0.1,
        "fadeOut": 0.3,
        "pan": {
          "min": 0.2,
          "max": 0.8
        },
        "pitch": {
          "min": 0.96,
          "max": 1.04
        }
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/9edeaadb-182a-481b-a66e-6cb07a114294.mp3",
          "https://r2.anxietyaidtools.com/custom/597f0bdb-c0fc-41db-a433-bcb898489235.mp3"
        ],
        "volume": {
          "min": 0.55,
          "max": 0.8
        },
        "interval": {
          "type": "random",
          "min": 20,
          "max": 60
        },
        "fadeIn": 0.05,
        "fadeOut": 0.2,
        "pan": {
          "min": 0.15,
          "max": 0.85
        },
        "pitch": {
          "min": 0.97,
          "max": 1.03
        }
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/8c210a17-70c5-4aa1-8bf9-eb9bc5473f40.mp3"
        ],
        "volume": {
          "min": 0.35,
          "max": 0.55
        },
        "interval": {
          "type": "random",
          "min": 25,
          "max": 75
        },
        "fadeIn": 0.2,
        "fadeOut": 0.5,
        "pan": {
          "min": 0.1,
          "max": 0.9
        },
        "pitch": {
          "min": 0.98,
          "max": 1.02
        }
      }
    ]
  },
  {
    "id": "thunderstorm",
    "categories": [
      "anxiety",
      "sleep"
    ],
    "layers": [
      {
        "files": [
          "https://r2.anxietyaidtools.com/ambient/RAIN_06/GENERAL/RAIN-LR_Thailand-Rain%2C%20General%2C%20Monsoon%2C%20Heavy%20Downpour%2C%20House%2C%20Exterior%2C%20Metallic%20Garage%20Roof%2C%20Concrete%2C%20Nighttime%2C%20Chiang%20Mai%2C%2005_FTUS_WOSB.mp3"
        ],
        "volume": 0.55,
        "loop": true,
        "fadeIn": 0.5,
        "crossfade": 3
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/ambient/RAIN_02/CONCRETE/RAINConc-LR_Singapore-Rain%2C%20Concrete%2C%20Backyard%2C%2011th%20Floor%2C%20No%20Windows%20Rain%20Dripping_FTUS_WOSB.mp3"
        ],
        "volume": 0.4,
        "loop": true,
        "fadeIn": 0.8,
        "crossfade": 2.5,
        "pan": {
          "min": 0.35,
          "max": 0.65
        }
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/ambient/RAIN_05/GENERAL/RAIN-LR_NewZealand-Rain%2C%20General%2C%20Rain%20Drops%2C%20Dripping%2C%20Trees%2C%20Leaves%2C%20Concrete%2C%20Wood%2C%20Birds%2C%20Residential%20Neighborhood%2C%20Auckland%2C%2004_FTUS_WOSB.mp3"
        ],
        "volume": {
          "min": 0.25,
          "max": 0.35
        },
        "interval": {
          "type": "random",
          "min": 40,
          "max": 90
        },
        "fadeIn": 2,
        "fadeOut": 3,
        "duration": 60,
        "pan": {
          "min": 0.2,
          "max": 0.8
        }
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/ambient/WEATHER_02/THUNDER/THUN-LR_Malaysia-Weather%2C%20Thunder%2C%20Clap%2C%20Rumble%2C%20Condominium%2C%20High%20Rise%2C%20Open%20Window%2C%20Rain%20Dripping%2C%20Room%20Tone%2C%2004_FTUS_WOSB.mp3",
          "https://r2.anxietyaidtools.com/ambient/WEATHER_02/THUNDER/THUN-LR_Malaysia-Weather%2C%20Thunder%2C%20Clap%2C%20Rumble%2C%20Condominium%2C%20High%20Rise%2C%20Open%20Window%2C%20Rain%20Dripping%2C%20Room%20Tone%2C%2013_FTUS_WOSB.mp3",
          "https://r2.anxietyaidtools.com/ambient/WEATHER_02/THUNDER/THUN-LR_Malaysia-Weather%2C%20Thunder%2C%20Clap%2C%20Rumble%2C%20Condominium%2C%20High%20Rise%2C%20Open%20Window%2C%20Rain%20Dripping%2C%20Room%20Tone%2C%2007_FTUS_WOSB.mp3"
        ],
        "volume": {
          "min": 0.55,
          "max": 0.75
        },
        "interval": {
          "type": "random",
          "min": 8,
          "max": 25
        },
        "fadeIn": 0.1,
        "fadeOut": 0.8,
        "pan": {
          "min": 0.1,
          "max": 0.9
        },
        "pitch": {
          "min": 0.97,
          "max": 1.03
        }
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/ambient/WEATHER_02/THUNDER/THUN-LR_Malaysia-Weather%2C%20Thunder%2C%20Clap%2C%20Rumble%2C%20Condominium%2C%20High%20Rise%2C%20Open%20Window%2C%20Rain%20Dripping%2C%20Room%20Tone%2C%2011_FTUS_WOSB.mp3",
          "https://r2.anxietyaidtools.com/ambient/WEATHER_02/THUNDER/THUN-LR_Malaysia-Weather%2C%20Thunder%2C%20Clap%2C%20Rumble%2C%20Condominium%2C%20High%20Rise%2C%20Open%20Window%2C%20Rain%20Dripping%2C%20Room%20Tone%2C%20Distance%20Sirens_FTUS_WOSB.mp3"
        ],
        "volume": {
          "min": 0.45,
          "max": 0.65
        },
        "interval": {
          "type": "random",
          "min": 30,
          "max": 70
        },
        "fadeIn": 0.3,
        "fadeOut": 1.2,
        "pan": {
          "min": 0.15,
          "max": 0.85
        },
        "pitch": {
          "min": 0.95,
          "max": 1.0
        }
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/ambient/WEATHER_02/THUNDER/THUN-LR_USA-Weather%2C%20Thunder%2C%20Firefighter%2C%20Siren%20Background%2C%20Rain%2C%20Thunder%20Rolling%2C%20Lightning%20Strike%2C%20City%2C%20Wet%20Streets%2C%20Dripping%2C%20Apartment%20Complex%2C%20Denver_FTUS_WOSB.mp3"
        ],
        "volume": {
          "min": 0.35,
          "max": 0.5
        },
        "interval": {
          "type": "random",
          "min": 80,
          "max": 180
        },
        "fadeIn": 2.5,
        "fadeOut": 3,
        "duration": 90,
        "pan": {
          "min": 0.0,
          "max": 1.0
        }
      }
    ]
  },
  {
    "id": "ancient-vessel",
    "categories": [
      "meditation",
      "sleep"
    ],
    "layers": [
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/a3ebe847-e28d-4411-a56c-d6bc30060891.mp3"
        ],
        "volume": 0.45,
        "loop": true,
        "fadeIn": 1.0,
        "crossfade": 4.0
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/9f9664db-4c1d-4c84-aec1-9314a94e40b4.mp3"
        ],
        "volume": {
          "min": 0.55,
          "max": 0.75
        },
        "interval": {
          "type": "random",
          "min": 8,
          "max": 18
        },
        "fadeIn": 0.5,
        "fadeOut": 1.2,
        "pan": {
          "min": 0.3,
          "max": 0.7
        },
        "pitch": {
          "min": 0.98,
          "max": 1.02
        }
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/9f9664db-4c1d-4c84-aec1-9314a94e40b4.mp3"
        ],
        "volume": {
          "min": 0.25,
          "max": 0.4
        },
        "interval": {
          "type": "random",
          "min": 25,
          "max": 65
        },
        "fadeIn": 1.5,
        "fadeOut": 2.0,
        "pan": {
          "min": 0.1,
          "max": 0.9
        },
        "pitch": {
          "min": 0.9,
          "max": 0.95
        }
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/41193fc4-279e-46d1-a868-23deb8ba840d.mp3"
        ],
        "volume": {
          "min": 0.35,
          "max": 0.5
        },
        "interval": {
          "type": "random",
          "min": 20,
          "max": 50
        },
        "fadeIn": 2.0,
        "fadeOut": 2.5,
        "pan": {
          "min": 0.2,
          "max": 0.8
        }
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/83c64d41-d43b-4957-9e32-aafc803bf85f.mp3"
        ],
        "volume": {
          "min": 0.25,
          "max": 0.4
        },
        "interval": {
          "type": "random",
          "min": 45,
          "max": 95
        },
        "fadeIn": 1.0,
        "fadeOut": 2.0,
        "pan": {
          "min": 0.0,
          "max": 1.0
        },
        "pitch": {
          "min": 0.98,
          "max": 1.05
        }
      },
      {
        "files": [
          "https://r2.anxietyaidtools.com/custom/ae7157eb-4b5a-40e2-baf3-69c00fcd3e70.mp3"
        ],
        "volume": {
          "min": 0.2,
          "max": 0.35
        },
        "interval": {
          "type": "random",
          "min": 70,
          "max": 160
        },
        "fadeIn": 0.8,
        "fadeOut": 1.5,
        "pan": {
          "min": 0.1,
          "max": 0.9
        }
      }
    ]
  }
];

export function narrationLanguage(locale) {
  const value = String(locale || "en").toLowerCase();
  if (value.startsWith("es")) return "es";
  if (value.startsWith("pt")) return "pt";
  if (value.startsWith("zh")) return "zh";
  return "en";
}

/** 5-4-3-2-1 grounding senses (AAT grounding), in countdown order. */
export const GROUNDING_SENSES = [
  { id: "see", icon: "eye", items: 5 },
  { id: "touch", icon: "hand", items: 4 },
  { id: "hear", icon: "ear", items: 3 },
  { id: "smell", icon: "flower", items: 2 },
  { id: "taste", icon: "coffee", items: 1 },
];

/** Guided breathing patterns (AAT guided breathing). Holds say which way the lungs are. */
export const GUIDED_PATTERNS = [
  { id: "box", cycles: 8, phases: [["in", 4], ["hold-full", 4], ["out", 4], ["hold-empty", 4]] },
  { id: "calming", cycles: 4, phases: [["in", 4], ["hold-full", 7], ["out-long", 8]] },
  { id: "energizing", cycles: 8, phases: [["in", 4], ["hold-full", 4], ["out", 6]] },
  { id: "quick", cycles: 6, phases: [["in", 3], ["hold-full", 3], ["out", 3]] },
];
export const GUIDED_PATTERN_IDS = GUIDED_PATTERNS.map((pattern) => pattern.id);

export const PMR_GROUP_IDS = [
  "right-hand",
  "left-hand",
  "right-arm",
  "left-arm",
  "forehead",
  "face",
  "jaw",
  "neck",
  "shoulders",
  "upper-back",
  "abdomen",
  "lower-back",
  "hips",
  "right-thigh",
  "left-thigh",
  "right-calf",
  "left-calf",
  "right-foot",
  "left-foot",
];

/** Bullet counts per group. Arms have four tense steps; everything else has three. */
export const PMR_CUE_COUNTS = {
  "right-hand": { tense: 3, release: 3 },
  "left-hand": { tense: 3, release: 3 },
  "right-arm": { tense: 4, release: 3 },
  "left-arm": { tense: 4, release: 3 },
  forehead: { tense: 3, release: 3 },
  face: { tense: 3, release: 3 },
  jaw: { tense: 3, release: 3 },
  neck: { tense: 3, release: 3 },
  shoulders: { tense: 3, release: 3 },
  "upper-back": { tense: 3, release: 3 },
  abdomen: { tense: 3, release: 3 },
  "lower-back": { tense: 3, release: 3 },
  hips: { tense: 3, release: 3 },
  "right-thigh": { tense: 3, release: 3 },
  "left-thigh": { tense: 3, release: 3 },
  "right-calf": { tense: 3, release: 3 },
  "left-calf": { tense: 3, release: 3 },
  "right-foot": { tense: 3, release: 3 },
  "left-foot": { tense: 3, release: 3 },
};

function cueLines(t, id, phase, count) {
  const lines = [];
  for (let index = 1; index <= count; index += 1) {
    lines.push(t(`pmr.group.${id}.${phase}.${index}`));
  }
  return lines;
}

export const CITATIONS = [
  {
    label: "Ma X. et al. (2017). The Effect of Diaphragmatic Breathing on Attention, Negative Affect and Stress in Healthy Adults. Frontiers in Psychology, 8:874.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5455070/",
  },
  {
    label: "Zaccaro A. et al. (2018). How Breath-Control Can Change Your Life: A Systematic Review on Psycho-Physiological Correlates of Slow Breathing. Frontiers in Human Neuroscience, 12:353.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6137615/",
  },
  {
    label: "Russo M.A., Santarelli D.M., O'Rourke D. (2017). The physiological effects of slow breathing in the healthy human. Breathe, 13(4):298-309.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5709795/",
  },
  {
    label: "Systematic review: breathing retraining across 16 studies in panic disorder and agoraphobia.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC9954474/",
  },
  {
    label: "Controlled trial: guided deep-breathing exercise and anxiety in hospitalized patients (DASS-21).",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11535222/",
  },
  {
    label: "Clinical study: three months of daily regulated breathing practice in generalized anxiety disorder (BAI).",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8989478/",
  },
];

export const PMR_CITATIONS = [
  {
    label: "Liu K. et al. (2020). Positive effects of a progressive muscle relaxation program on depression and sleep quality in patients with COVID-19. Complement Ther Clin Pract, 39:101132.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7102525/",
  },
  {
    label: "Randomized controlled trial (2022): progressive muscle relaxation significantly reduced anxiety scores on DASS-21 in nurses in high-stress settings.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10844009/",
  },
  {
    label: "Ghafari S. et al. (2014). Effectiveness of progressive muscle relaxation on test anxiety among nursing students. J Educ Health Promot, 3:117.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC4280725/",
  },
  {
    label: "Merakou K. et al. (2022). Progressive muscle relaxation training for anxiety reduction in nursing students during clinical practice. Int J Environ Res Public Health, 19(8):4873.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC9047807/",
  },
];

export const GROUNDING_CITATIONS = [
  {
    label: "Li L. et al. (2025). Mindful energy balance exercise protocol as an adjunctive intervention for pediatric Tourette syndrome: a randomized controlled trial. Scientific Reports.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC12550066/",
  },
  {
    label: "Palmer D.D.G. et al. (2023). Outcomes of an Integrated Multidisciplinary Clinic for People with Functional Neurological Disorder. Movement Disorders Clinical Practice.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10272915/",
  },
  {
    label: "Myers L. et al. (2021). Using evidence-based psychotherapy to tailor treatment for patients with functional neurological disorders. Epilepsy & Behavior Reports.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8515382/",
  },
];

export function buildCalmPattern(t) {
  return {
    id: "calm",
    name: t("pattern.name"),
    hint: t("pattern.hint"),
    phases: [
      { kind: "in", seconds: 4, label: t("phase.in.label") },
      { kind: "out", seconds: 6, label: t("phase.out.label") },
    ],
    cycles: 10,
  };
}

function guidedPhase(t, step, seconds) {
  if (step === "in") return { kind: "in", seconds, label: t("phase.in.label") };
  if (step === "out") return { kind: "out", seconds, label: t("phase.out.label") };
  if (step === "out-long") return { kind: "out", seconds, label: t("guided.phase.outLong") };
  if (step === "hold-full") return { kind: "hold", seconds, label: t("guided.phase.holdFull") };
  return { kind: "hold", seconds, label: t("guided.phase.holdEmpty") };
}

/**
 * Guided patterns with the AAT cue pair timed to each: the inhale cue runs
 * through the hold after it, the exhale cue through the hold after that.
 */
export function buildGuidedPatterns(t, assets) {
  const sound = assets?.sound ? (name) => assets.sound(name) : (name) => ({ kind: "sound", name });
  return GUIDED_PATTERNS.map((pattern) => ({
    id: pattern.id,
    name: t(`guided.pattern.${pattern.id}.name`),
    hint: t(`guided.pattern.${pattern.id}.hint`),
    phases: pattern.phases.map(([step, seconds]) => guidedPhase(t, step, seconds)),
    cycles: pattern.cycles,
    cues: {
      inhale: sound(`guided-${pattern.id}-in`),
      exhale: sound(`guided-${pattern.id}-out`),
    },
  }));
}

export function buildPractices(t) {
  return [
    { id: "breathing", name: t("practice.breathing"), icon: "leaf" },
    { id: "guided-breathing", name: t("practice.guided"), icon: "timer" },
    { id: "pmr", name: t("practice.pmr"), icon: "person-standing" },
    { id: "grounding", name: t("practice.grounding"), icon: "anchor" },
    { id: "meditation", name: t("practice.meditation"), icon: "headphones" },
    { id: "visualization", name: t("practice.visualization"), icon: "sparkles" },
    { id: "sounds", name: t("practice.sounds"), icon: "waves" },
  ];
}

export const SOUNDSCAPE_IDS = SOUNDSCAPES.map((scene) => scene.id);

export function buildSoundScenes(t, assets) {
  const image = assets?.image ? (name) => assets.image(name) : (name) => ({ kind: "image", name });
  return SOUNDSCAPES.map((scene) => ({
    id: scene.id,
    title: t(`sounds.${scene.id}.title`),
    subtitle: scene.categories.map((category) => t(`sounds.category.${category}`)).join(" · "),
    cover: image(`sounds-${scene.id}`),
    layers: scene.layers,
  }));
}

/** Asset names are lowercase; scene ids are AAT's camelCase keys. */
function visualizationCoverName(sceneId) {
  const kebab = sceneId.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  return `visualization-${kebab}`;
}

export function buildVisualizationTracks(t, locale, assets) {
  const svg = assets?.svg ? (name) => assets.svg(name) : (name) => ({ kind: "svg", name });
  const language = narrationLanguage(locale);
  return VISUALIZATION_SCENES.map((scene) => {
    const segments = [];
    for (let index = 1; index <= VISUALIZATION_STEPS; index += 1) {
      segments.push({
        audioUrl: `${MEDIA_ORIGIN}/peaceful-visualization/${language}/${scene}/${String(index).padStart(2, "0")}.mp3`,
        caption: t(`visualization.${scene}.caption${index}`),
      });
    }
    return {
      id: scene,
      title: t(`visualization.${scene}.title`),
      subtitle: t(`visualization.${scene}.subtitle`),
      cover: svg(visualizationCoverName(scene)),
      segments,
    };
  });
}

export function buildMeditationTracks(t, locale, assets) {
  const image = assets?.image ? (name) => assets.image(name) : (name) => ({ kind: "image", name });
  const language = narrationLanguage(locale);
  return MEDITATION_SESSIONS.map((session) => {
    const segments = [];
    for (let index = 1; index <= session.segments; index += 1) {
      const file = String(index).padStart(2, "0");
      segments.push({
        audioUrl: `${MEDIA_ORIGIN}/guided-meditation/${language}/${session.id}/${file}.mp3`,
        caption: t(`meditation.${session.id}.caption${index}`),
      });
    }
    return {
      id: session.id,
      title: t(`meditation.${session.id}.title`),
      subtitle: t(`meditation.category.${session.category}`),
      cover: image(`meditation-${session.id}`),
      segments,
    };
  });
}

export function buildGroundingSteps(t) {
  return GROUNDING_SENSES.map((sense) => {
    const items = [];
    for (let index = 1; index <= sense.items; index += 1) {
      items.push({
        text: t(`grounding.${sense.id}.item${index}.text`),
        guidance: t(`grounding.${sense.id}.item${index}.guidance`),
      });
    }
    return {
      id: sense.id,
      label: t(`grounding.${sense.id}.label`),
      title: t(`grounding.${sense.id}.title`),
      prompt: t(`grounding.${sense.id}.prompt`),
      icon: sense.icon,
      items,
    };
  });
}

export function buildPmrSteps(ctx) {
  const t = typeof ctx === "function" ? ctx : (key) => ctx.t(key);
  const assets = typeof ctx === "function" ? undefined : ctx?.assets;
  const svg = assets?.svg ? (name) => assets.svg(name) : (name) => ({ kind: "svg", name });
  const tenseLabel = t("pmr.phase.tense");
  const releaseLabel = t("pmr.phase.release");
  return PMR_GROUP_IDS.map((id) => {
    const counts = PMR_CUE_COUNTS[id];
    const tenseCues = cueLines(t, id, "tense", counts.tense);
    const releaseCues = cueLines(t, id, "release", counts.release);
    return {
      id,
      name: t(`pmr.group.${id}.name`),
      tenseSeconds: 10,
      releaseSeconds: 10,
      tenseLabel,
      releaseLabel,
      tenseCues,
      releaseCues,
      tenseCue: tenseCues[0],
      releaseCue: releaseCues[0],
      tenseIllustration: svg(`pmr-${id}-tense`),
      releaseIllustration: svg(`pmr-${id}-release`),
    };
  });
}

export function buildSessionInfo(t, logo) {
  return {
    intro: t("info.intro"),
    sections: [
      {
        heading: t("info.how.heading"),
        body: t("info.how.body"),
        cards: [
          { title: t("info.how.card1.title"), body: t("info.how.card1.body"), icon: "activity" },
          { title: t("info.how.card2.title"), body: t("info.how.card2.body"), icon: "wind" },
          { title: t("info.how.card3.title"), body: t("info.how.card3.body"), icon: "trending-down" },
        ],
      },
      {
        heading: t("info.science.heading"),
        body: t("info.science.body"),
        cards: [
          { title: t("info.science.card1.title"), body: t("info.science.card1.body"), icon: "heart-pulse", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11535222/" },
          { title: t("info.science.card2.title"), body: t("info.science.card2.body"), icon: "shield-check", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC9954474/" },
          { title: t("info.science.card3.title"), body: t("info.science.card3.body"), icon: "brain", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8989478/" },
        ],
      },
      {
        heading: t("info.when.heading"),
        items: [t("info.when.item1"), t("info.when.item2"), t("info.when.item3"), t("info.when.item4")],
      },
      {
        heading: t("info.notice.heading"),
        items: [t("info.notice.item1"), t("info.notice.item2"), t("info.notice.item3"), t("info.notice.item4")],
      },
      {
        heading: t("info.tips.heading"),
        cards: [
          { title: t("info.tips.card1.title"), body: t("info.tips.card1.body"), icon: "person-standing" },
          { title: t("info.tips.card2.title"), body: t("info.tips.card2.body"), icon: "armchair" },
          { title: t("info.tips.card3.title"), body: t("info.tips.card3.body"), icon: "calendar-check" },
        ],
      },
    ],
    citations: CITATIONS,
    disclaimer: t("info.disclaimer"),
    site: { label: t("info.site.label"), url: SITE_URL },
    ...(logo ? { logo } : {}),
  };
}

const GUIDED_PATTERN_ICONS = { box: "square", calming: "moon", energizing: "zap", quick: "timer" };

/**
 * Guided breathing Info: every pattern as a card (the selected one marked, as
 * on AAT's guided breathing page), then the shared breathing knowledge.
 */
export function buildGuidedInfo(t, logo, patternId) {
  const patternCards = GUIDED_PATTERN_IDS.map((id) => ({
    title: t(`guided.pattern.${id}.heading`),
    body: t(`guided.pattern.${id}.body`),
    detail: t(`guided.pattern.${id}.detail`),
    icon: GUIDED_PATTERN_ICONS[id],
    ...(id === patternId ? { highlighted: true } : {}),
  }));
  return {
    intro: t("guided.info.intro"),
    sections: [
      {
        heading: t("guided.info.patterns.heading"),
        body: t("guided.info.patterns.body"),
        cards: patternCards,
      },
      {
        heading: t("info.how.heading"),
        body: t("guided.info.how.body"),
        cards: [
          { title: t("guided.info.how.card1.title"), body: t("guided.info.how.card1.body"), icon: "activity" },
          { title: t("guided.info.how.card2.title"), body: t("guided.info.how.card2.body"), icon: "timer" },
          { title: t("guided.info.how.card3.title"), body: t("guided.info.how.card3.body"), icon: "brain" },
        ],
      },
      {
        heading: t("info.science.heading"),
        body: t("info.science.body"),
        cards: [
          { title: t("info.science.card1.title"), body: t("info.science.card1.body"), icon: "heart-pulse", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11535222/" },
          { title: t("info.science.card2.title"), body: t("info.science.card2.body"), icon: "shield-check", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC9954474/" },
          { title: t("info.science.card3.title"), body: t("info.science.card3.body"), icon: "brain", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8989478/" },
        ],
      },
      {
        heading: t("info.when.heading"),
        items: [t("guided.info.when.item1"), t("guided.info.when.item2"), t("guided.info.when.item3"), t("guided.info.when.item4")],
      },
      {
        heading: t("info.notice.heading"),
        items: [t("info.notice.item1"), t("info.notice.item2"), t("info.notice.item3"), t("info.notice.item4")],
      },
      {
        heading: t("info.tips.heading"),
        cards: [
          { title: t("guided.info.tips.card1.title"), body: t("guided.info.tips.card1.body"), icon: "calendar-check" },
          { title: t("guided.info.tips.card2.title"), body: t("guided.info.tips.card2.body"), icon: "armchair" },
          { title: t("guided.info.tips.card3.title"), body: t("guided.info.tips.card3.body"), icon: "shield-check" },
        ],
      },
    ],
    citations: CITATIONS,
    disclaimer: t("guided.info.disclaimer"),
    site: { label: t("info.site.label"), url: SITE_URL },
    ...(logo ? { logo } : {}),
  };
}

/**
 * Grounding Info. The science section says plainly that the evidence covers
 * sensory grounding inside wider programs, not 5-4-3-2-1 alone.
 */
export function buildGroundingInfo(t, logo) {
  return {
    intro: t("grounding.info.intro"),
    sections: [
      {
        heading: t("info.how.heading"),
        body: t("grounding.info.how.body"),
        cards: [
          { title: t("grounding.info.how.card1.title"), body: t("grounding.info.how.card1.body"), icon: "eye" },
          { title: t("grounding.info.how.card2.title"), body: t("grounding.info.how.card2.body"), icon: "brain" },
          { title: t("grounding.info.how.card3.title"), body: t("grounding.info.how.card3.body"), icon: "anchor" },
        ],
      },
      {
        heading: t("info.science.heading"),
        body: t("grounding.info.science.body"),
        cards: [
          { title: t("grounding.info.science.card1.title"), body: t("grounding.info.science.card1.body"), icon: "heart-pulse", url: GROUNDING_CITATIONS[0].url },
          { title: t("grounding.info.science.card2.title"), body: t("grounding.info.science.card2.body"), icon: "activity", url: GROUNDING_CITATIONS[1].url },
          { title: t("grounding.info.science.card3.title"), body: t("grounding.info.science.card3.body"), icon: "shield-check", url: GROUNDING_CITATIONS[2].url },
        ],
      },
      {
        heading: t("info.when.heading"),
        items: [t("grounding.info.when.item1"), t("grounding.info.when.item2"), t("grounding.info.when.item3"), t("grounding.info.when.item4")],
      },
      {
        heading: t("info.notice.heading"),
        items: [t("grounding.info.notice.item1"), t("grounding.info.notice.item2"), t("grounding.info.notice.item3"), t("grounding.info.notice.item4")],
      },
      {
        heading: t("info.tips.heading"),
        cards: [
          { title: t("grounding.info.tips.card1.title"), body: t("grounding.info.tips.card1.body"), icon: "timer" },
          { title: t("grounding.info.tips.card2.title"), body: t("grounding.info.tips.card2.body"), icon: "eye" },
          { title: t("grounding.info.tips.card3.title"), body: t("grounding.info.tips.card3.body"), icon: "anchor" },
        ],
      },
    ],
    citations: GROUNDING_CITATIONS,
    disclaimer: t("grounding.info.disclaimer"),
    site: { label: t("info.site.label"), url: SITE_URL },
    ...(logo ? { logo } : {}),
  };
}

export const MEDITATION_CITATIONS = [
  {
    label: "Goyal M. et al. (2014). Meditation programs for psychological stress and well-being: a systematic review and meta-analysis. JAMA Internal Medicine, 174(3):357–368.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC4142584/",
  },
  {
    label: "Hofmann S.G. et al. (2010). The effect of mindfulness-based therapy on anxiety and depression: a meta-analytic review. Journal of Consulting and Clinical Psychology, 78(2):169–183.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC2848393/",
  },
  {
    label: "Hofmann S.G., Grossman P., Hinton D.E. (2011). Loving-kindness and compassion meditation: potential for psychological interventions. Clinical Psychology Review, 31(7):1126–1132.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3176989/",
  },
];

export const VISUALIZATION_CITATIONS = [
  {
    label: "Parizad N. et al. (2021). Effect of guided imagery on anxiety, muscle pain, and vital signs in patients with COVID-19: a randomized controlled trial. Complementary Therapies in Clinical Practice, 43:101335.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7982304/",
  },
  {
    label: "Forward J.B. et al. (2015). Effect of structured touch and guided imagery for pain and anxiety in elective joint replacement patients: a randomized controlled trial. The Permanente Journal, 19(4):18–28.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC4625990/",
  },
  {
    label: "Kumari D., Patil J. (2023). Guided imagery for anxiety disorder: therapeutic efficacy and changes in quality of life. Industrial Psychiatry Journal, 32(Suppl 1):S191–S195.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10871407/",
  },
];

export function buildVisualizationInfo(t, logo) {
  return {
    intro: t("visualization.info.intro"),
    sections: [
      {
        heading: t("info.how.heading"),
        body: t("visualization.info.how.body"),
        cards: [
          { title: t("visualization.info.how.card1.title"), body: t("visualization.info.how.card1.body"), icon: "leaf" },
          { title: t("visualization.info.how.card2.title"), body: t("visualization.info.how.card2.body"), icon: "sparkles" },
          { title: t("visualization.info.how.card3.title"), body: t("visualization.info.how.card3.body"), icon: "calendar-check" },
        ],
      },
      {
        heading: t("info.science.heading"),
        body: t("visualization.info.science.body"),
        cards: [
          { title: t("visualization.info.science.card1.title"), body: t("visualization.info.science.card1.body"), icon: "heart-pulse", url: VISUALIZATION_CITATIONS[0].url },
          { title: t("visualization.info.science.card2.title"), body: t("visualization.info.science.card2.body"), icon: "activity", url: VISUALIZATION_CITATIONS[1].url },
          { title: t("visualization.info.science.card3.title"), body: t("visualization.info.science.card3.body"), icon: "brain", url: VISUALIZATION_CITATIONS[2].url },
        ],
      },
      {
        heading: t("info.when.heading"),
        items: [t("visualization.info.when.item1"), t("visualization.info.when.item2"), t("visualization.info.when.item3"), t("visualization.info.when.item4")],
      },
      {
        heading: t("info.tips.heading"),
        cards: [
          { title: t("visualization.info.tips.card1.title"), body: t("visualization.info.tips.card1.body"), icon: "headphones" },
          { title: t("visualization.info.tips.card2.title"), body: t("visualization.info.tips.card2.body"), icon: "eye" },
          { title: t("visualization.info.tips.card3.title"), body: t("visualization.info.tips.card3.body"), icon: "anchor" },
        ],
      },
    ],
    citations: VISUALIZATION_CITATIONS,
    disclaimer: t("visualization.info.disclaimer"),
    site: { label: t("info.site.label"), url: SITE_URL },
    ...(logo ? { logo } : {}),
  };
}

export const SOUNDS_CITATIONS = [
  {
    label: "Alvarsson J.J., Wiens S., Nilsson M.E. (2010). Stress recovery during exposure to nature sound and environmental noise. International Journal of Environmental Research and Public Health, 7(3):1036–1046.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC2872309/",
  },
  {
    label: "Buxton R.T. et al. (2021). A synthesis of health benefits of natural sounds and their distribution in national parks. Proceedings of the National Academy of Sciences, 118(14):e2013097118.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8040792/",
  },
];

export function buildSoundsInfo(t, logo) {
  return {
    intro: t("sounds.info.intro"),
    sections: [
      {
        heading: t("info.how.heading"),
        body: t("sounds.info.how.body"),
        cards: [
          { title: t("sounds.info.how.card1.title"), body: t("sounds.info.how.card1.body"), icon: "waves" },
          { title: t("sounds.info.how.card2.title"), body: t("sounds.info.how.card2.body"), icon: "shield-check" },
          { title: t("sounds.info.how.card3.title"), body: t("sounds.info.how.card3.body"), icon: "sparkles" },
        ],
      },
      {
        heading: t("info.science.heading"),
        body: t("sounds.info.science.body"),
        cards: [
          { title: t("sounds.info.science.card1.title"), body: t("sounds.info.science.card1.body"), icon: "heart-pulse", url: SOUNDS_CITATIONS[0].url },
          { title: t("sounds.info.science.card2.title"), body: t("sounds.info.science.card2.body"), icon: "brain", url: SOUNDS_CITATIONS[1].url },
        ],
      },
      {
        heading: t("info.when.heading"),
        items: [t("sounds.info.when.item1"), t("sounds.info.when.item2"), t("sounds.info.when.item3"), t("sounds.info.when.item4")],
      },
      {
        heading: t("info.tips.heading"),
        cards: [
          { title: t("sounds.info.tips.card1.title"), body: t("sounds.info.tips.card1.body"), icon: "headphones" },
          { title: t("sounds.info.tips.card2.title"), body: t("sounds.info.tips.card2.body"), icon: "timer" },
          { title: t("sounds.info.tips.card3.title"), body: t("sounds.info.tips.card3.body"), icon: "leaf" },
        ],
      },
    ],
    citations: SOUNDS_CITATIONS,
    disclaimer: t("sounds.info.disclaimer"),
    site: { label: t("info.site.label"), url: SITE_URL },
    ...(logo ? { logo } : {}),
  };
}

/** Meditation Info: the sessions (current one marked), then the shared knowledge. */
export function buildMeditationInfo(t, logo, trackId) {
  const sessionCards = (group) => MEDITATION_SESSIONS
    .filter((session) => session.group === group)
    .map((session) => ({
      title: t(`meditation.${session.id}.title`),
      body: t(`meditation.${session.id}.about`),
      detail: t(`meditation.category.${session.category}`),
      icon: session.group === "grounded" ? "leaf" : "sparkles",
      ...(session.id === trackId ? { highlighted: true } : {}),
    }));
  return {
    intro: t("meditation.info.intro"),
    sections: [
      { heading: t("meditation.info.grounded.heading"), cards: sessionCards("grounded") },
      { heading: t("meditation.info.spiritual.heading"), cards: sessionCards("spiritual") },
      {
        heading: t("info.how.heading"),
        body: t("meditation.info.how.body"),
        cards: [
          { title: t("meditation.info.how.card1.title"), body: t("meditation.info.how.card1.body"), icon: "headphones" },
          { title: t("meditation.info.how.card2.title"), body: t("meditation.info.how.card2.body"), icon: "heart-pulse" },
          { title: t("meditation.info.how.card3.title"), body: t("meditation.info.how.card3.body"), icon: "brain" },
        ],
      },
      {
        heading: t("info.science.heading"),
        body: t("meditation.info.science.body"),
        cards: [
          { title: t("meditation.info.science.card1.title"), body: t("meditation.info.science.card1.body"), icon: "activity", url: MEDITATION_CITATIONS[0].url },
          { title: t("meditation.info.science.card2.title"), body: t("meditation.info.science.card2.body"), icon: "shield-check", url: MEDITATION_CITATIONS[1].url },
          { title: t("meditation.info.science.card3.title"), body: t("meditation.info.science.card3.body"), icon: "sparkles", url: MEDITATION_CITATIONS[2].url },
        ],
      },
      {
        heading: t("info.when.heading"),
        items: [t("meditation.info.when.item1"), t("meditation.info.when.item2"), t("meditation.info.when.item3"), t("meditation.info.when.item4")],
      },
      {
        heading: t("info.tips.heading"),
        cards: [
          { title: t("meditation.info.tips.card1.title"), body: t("meditation.info.tips.card1.body"), icon: "headphones" },
          { title: t("meditation.info.tips.card2.title"), body: t("meditation.info.tips.card2.body"), icon: "armchair" },
          { title: t("meditation.info.tips.card3.title"), body: t("meditation.info.tips.card3.body"), icon: "calendar-check" },
        ],
      },
    ],
    citations: MEDITATION_CITATIONS,
    disclaimer: t("meditation.info.disclaimer"),
    site: { label: t("info.site.label"), url: SITE_URL },
    ...(logo ? { logo } : {}),
  };
}

export function buildPmrInfo(t, logo) {
  return {
    intro: t("pmr.info.intro"),
    sections: [
      {
        heading: t("pmr.info.how.heading"),
        body: t("pmr.info.how.body"),
        cards: [
          { title: t("pmr.info.how.card1.title"), body: t("pmr.info.how.card1.body"), icon: "activity" },
          { title: t("pmr.info.how.card2.title"), body: t("pmr.info.how.card2.body"), icon: "shield-check" },
          { title: t("pmr.info.how.card3.title"), body: t("pmr.info.how.card3.body"), icon: "person-standing" },
        ],
      },
      {
        heading: t("pmr.info.science.heading"),
        body: t("pmr.info.science.body"),
        cards: [
          { title: t("pmr.info.science.card1.title"), body: t("pmr.info.science.card1.body"), icon: "heart-pulse", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7102525/" },
          { title: t("pmr.info.science.card2.title"), body: t("pmr.info.science.card2.body"), icon: "shield-check", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10844009/" },
          { title: t("pmr.info.science.card3.title"), body: t("pmr.info.science.card3.body"), icon: "brain", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC9047807/" },
        ],
      },
      {
        heading: t("pmr.info.when.heading"),
        items: [t("pmr.info.when.item1"), t("pmr.info.when.item2"), t("pmr.info.when.item3"), t("pmr.info.when.item4")],
      },
      {
        heading: t("pmr.info.notice.heading"),
        items: [t("pmr.info.notice.item1"), t("pmr.info.notice.item2"), t("pmr.info.notice.item3"), t("pmr.info.notice.item4")],
      },
      {
        heading: t("pmr.info.tips.heading"),
        cards: [
          { title: t("pmr.info.tips.card1.title"), body: t("pmr.info.tips.card1.body"), icon: "armchair" },
          { title: t("pmr.info.tips.card2.title"), body: t("pmr.info.tips.card2.body"), icon: "activity" },
          { title: t("pmr.info.tips.card3.title"), body: t("pmr.info.tips.card3.body"), icon: "calendar-check" },
        ],
      },
    ],
    citations: PMR_CITATIONS,
    disclaimer: t("pmr.info.disclaimer"),
    site: { label: t("info.site.label"), url: SITE_URL },
    ...(logo ? { logo } : {}),
  };
}

export function buildBreathingDescriptor(ctx, autoStart, audioCuesEnabled) {
  const t = (key) => ctx.t(key);
  return {
    kind: "breathing",
    title: t("session.title"),
    subtitle: t("session.subtitle"),
    patterns: [buildCalmPattern(t)],
    patternId: "calm",
    autoStart,
    info: buildSessionInfo(t, ctx.assets.svg("logo")),
    audio: {
      inhale: ctx.assets.sound("breath-in"),
      exhale: ctx.assets.sound("breath-out"),
      enabled: audioCuesEnabled !== false,
    },
    practices: buildPractices(t),
    practiceId: "breathing",
  };
}

export function buildGuidedDescriptor(ctx, autoStart, audioCuesEnabled, patternId = GUIDED_PATTERN_IDS[0]) {
  const t = (key) => ctx.t(key);
  const selected = GUIDED_PATTERN_IDS.includes(patternId) ? patternId : GUIDED_PATTERN_IDS[0];
  return {
    kind: "breathing",
    title: t("guided.session.title"),
    subtitle: t("guided.session.subtitle"),
    patterns: buildGuidedPatterns(t, ctx.assets),
    patternId: selected,
    autoStart,
    info: buildGuidedInfo(t, ctx.assets.svg("logo"), selected),
    audio: {
      inhale: ctx.assets.sound("breath-in"),
      exhale: ctx.assets.sound("breath-out"),
      enabled: audioCuesEnabled !== false,
    },
    practices: buildPractices(t),
    practiceId: "guided-breathing",
  };
}

export function buildGroundingDescriptor(ctx, autoStart) {
  const t = (key) => ctx.t(key);
  return {
    kind: "grounding",
    title: t("grounding.session.title"),
    subtitle: t("grounding.session.subtitle"),
    steps: buildGroundingSteps(t),
    autoStart,
    // Self-paced: the first sense is the calm start, no lead-in countdown.
    countdownSeconds: 0,
    info: buildGroundingInfo(t, ctx.assets.svg("logo")),
    practices: buildPractices(t),
    practiceId: "grounding",
  };
}

export function buildMeditationDescriptor(ctx, autoStart, trackId = MEDITATION_IDS[0]) {
  const t = (key) => ctx.t(key);
  const selected = MEDITATION_IDS.includes(trackId) ? trackId : MEDITATION_IDS[0];
  const locale = ctx.locale ?? "en";
  const englishForOtherLocale = narrationLanguage(locale) === "en" && !String(locale).toLowerCase().startsWith("en");
  return {
    kind: "player",
    title: t("meditation.session.title"),
    subtitle: t("meditation.session.subtitle"),
    tracks: buildMeditationTracks(t, locale, ctx.assets),
    trackId: selected,
    autoStart,
    countdownSeconds: 3,
    segmentGapSeconds: 1.5,
    ...(englishForOtherLocale ? { narrationNote: t("meditation.narrationNote") } : {}),
    info: buildMeditationInfo(t, ctx.assets.svg("logo"), selected),
    practices: buildPractices(t),
    practiceId: "meditation",
  };
}

export function buildVisualizationDescriptor(ctx, autoStart, trackId = VISUALIZATION_SCENES[0]) {
  const t = (key) => ctx.t(key);
  const selected = VISUALIZATION_SCENES.includes(trackId) ? trackId : VISUALIZATION_SCENES[0];
  const locale = ctx.locale ?? "en";
  const englishForOtherLocale = narrationLanguage(locale) === "en" && !String(locale).toLowerCase().startsWith("en");
  return {
    kind: "player",
    title: t("visualization.session.title"),
    subtitle: t("visualization.session.subtitle"),
    tracks: buildVisualizationTracks(t, locale, ctx.assets),
    trackId: selected,
    autoStart,
    countdownSeconds: 3,
    segmentGapSeconds: 1.5,
    ...(englishForOtherLocale ? { narrationNote: t("meditation.narrationNote") } : {}),
    info: buildVisualizationInfo(t, ctx.assets.svg("logo")),
    practices: buildPractices(t),
    practiceId: "visualization",
  };
}

export function buildSoundsDescriptor(ctx, autoStart, sceneId = SOUNDSCAPE_IDS[0]) {
  const t = (key) => ctx.t(key);
  const selected = SOUNDSCAPE_IDS.includes(sceneId) ? sceneId : SOUNDSCAPE_IDS[0];
  return {
    kind: "soundscape",
    title: t("sounds.session.title"),
    subtitle: t("sounds.session.subtitle"),
    scenes: buildSoundScenes(t, ctx.assets),
    sceneId: selected,
    autoStart,
    countdownSeconds: 0,
    timerMinutes: [15, 30, 60],
    info: buildSoundsInfo(t, ctx.assets.svg("logo")),
    practices: buildPractices(t),
    practiceId: "sounds",
  };
}

export function buildPmrDescriptor(ctx, autoStart) {
  const t = (key) => ctx.t(key);
  return {
    kind: "pmr",
    title: t("pmr.session.title"),
    subtitle: t("pmr.session.subtitle"),
    steps: buildPmrSteps(ctx),
    autoStart,
    info: buildPmrInfo(t, ctx.assets.svg("logo")),
    practices: buildPractices(t),
    practiceId: "pmr",
  };
}

/** `selectionId` is the remembered pattern (guided breathing) or track (meditation). */
export function buildDescriptor(ctx, autoStart, audioCuesEnabled, practiceId = "breathing", guidedPatternId) {
  if (practiceId === "pmr") {
    return buildPmrDescriptor(ctx, autoStart);
  }
  if (practiceId === "guided-breathing") {
    return buildGuidedDescriptor(ctx, autoStart, audioCuesEnabled, guidedPatternId);
  }
  if (practiceId === "grounding") {
    return buildGroundingDescriptor(ctx, autoStart);
  }
  if (practiceId === "meditation") {
    return buildMeditationDescriptor(ctx, autoStart, guidedPatternId);
  }
  if (practiceId === "visualization") {
    return buildVisualizationDescriptor(ctx, autoStart, guidedPatternId);
  }
  if (practiceId === "sounds") {
    return buildSoundsDescriptor(ctx, autoStart, guidedPatternId);
  }
  return buildBreathingDescriptor(ctx, autoStart, audioCuesEnabled);
}

/** Remember the picked guided pattern and mark it in Info. */
async function selectGuidedPattern(ctx, session, patternId) {
  if (!GUIDED_PATTERN_IDS.includes(patternId)) return;
  await ctx.storage.set(STORAGE_KEY_LAST_GUIDED_PATTERN, patternId).catch(() => undefined);
  const t = (key) => ctx.t(key);
  try {
    await session.update({ patternId, info: buildGuidedInfo(t, ctx.assets.svg("logo"), patternId) });
  } catch (error) {
    ctx.log.warn("guided pattern info update failed", { patternId, reason: String(error && error.message ? error.message : error) });
  }
}

/** Remember the picked meditation and mark it in Info. */
async function selectMeditation(ctx, session, trackId) {
  if (!MEDITATION_IDS.includes(trackId)) return;
  await ctx.storage.set(STORAGE_KEY_LAST_MEDITATION, trackId).catch(() => undefined);
  const t = (key) => ctx.t(key);
  try {
    await session.update({ info: buildMeditationInfo(t, ctx.assets.svg("logo"), trackId) });
  } catch (error) {
    ctx.log.warn("meditation info update failed", { trackId, reason: String(error && error.message ? error.message : error) });
  }
}

async function openSession(ctx, state, autoStart, practiceId) {
  const audioCuesEnabled = (await ctx.storage.get(STORAGE_KEY_AUDIO_CUES)) !== false;
  let guidedPatternId;
  if (practiceId === "guided-breathing") guidedPatternId = await ctx.storage.get(STORAGE_KEY_LAST_GUIDED_PATTERN);
  else if (practiceId === "meditation") guidedPatternId = await ctx.storage.get(STORAGE_KEY_LAST_MEDITATION);
  else if (practiceId === "visualization") guidedPatternId = await ctx.storage.get(STORAGE_KEY_LAST_VISUALIZATION);
  else if (practiceId === "sounds") guidedPatternId = await ctx.storage.get(STORAGE_KEY_LAST_SOUNDSCAPE);
  const descriptor = buildDescriptor(ctx, autoStart, audioCuesEnabled, practiceId, guidedPatternId);

  const session = await ctx.ui.session(descriptor);
  state.session = session;
  state.practiceId = practiceId;

  session.onEvent((event) => {
    if (!event || state.session !== session) return;
    if (event.type === "patternChanged" && practiceId === "guided-breathing") {
      void selectGuidedPattern(ctx, session, event.patternId);
    } else if (event.type === "patternChanged" && practiceId === "meditation") {
      void selectMeditation(ctx, session, event.patternId);
    } else if (event.type === "patternChanged" && practiceId === "visualization" && VISUALIZATION_SCENES.includes(event.patternId)) {
      void ctx.storage.set(STORAGE_KEY_LAST_VISUALIZATION, event.patternId).catch(() => undefined);
    } else if (event.type === "patternChanged" && practiceId === "sounds" && SOUNDSCAPE_IDS.includes(event.patternId)) {
      void ctx.storage.set(STORAGE_KEY_LAST_SOUNDSCAPE, event.patternId).catch(() => undefined);
    } else if (event.type === "audioToggled") {
      void ctx.storage.set(STORAGE_KEY_AUDIO_CUES, event.enabled).catch(() => undefined);
    } else if (event.type === "practiceSelected") {
      void openSession(ctx, state, false, event.practiceId);
    } else if (event.type === "stopped") {
      if (state.session === session && event.reason !== "replaced") {
        state.session = null;
      }
    }
  });
}

export function register(OpenPetsPlugin) {
  OpenPetsPlugin.register({
    async start(ctx) {
      const state = { session: null, practiceId: "breathing" };
      await ctx.commands.register(
        {
          id: "start-breathing",
          title: "$t:practice.breathing",
          description: "$t:command.start.description",
        },
        () => openSession(ctx, state, true, "breathing"),
      );
      await ctx.commands.register(
        {
          id: "start-guided-breathing",
          title: "$t:practice.guided",
          description: "$t:command.startGuided.description",
        },
        () => openSession(ctx, state, true, "guided-breathing"),
      );
      await ctx.commands.register(
        {
          id: "start-pmr",
          title: "$t:practice.pmr",
          description: "$t:command.startPmr.description",
        },
        () => openSession(ctx, state, true, "pmr"),
      );
      await ctx.commands.register(
        {
          id: "start-grounding",
          title: "$t:practice.grounding",
          description: "$t:command.startGrounding.description",
        },
        () => openSession(ctx, state, true, "grounding"),
      );
      await ctx.commands.register(
        {
          id: "start-meditation",
          title: "$t:practice.meditation",
          description: "$t:command.startMeditation.description",
        },
        () => openSession(ctx, state, true, "meditation"),
      );
      await ctx.commands.register(
        {
          id: "start-visualization",
          title: "$t:practice.visualization",
          description: "$t:command.startVisualization.description",
        },
        () => openSession(ctx, state, true, "visualization"),
      );
      await ctx.commands.register(
        {
          id: "start-sounds",
          title: "$t:practice.sounds",
          description: "$t:command.startSounds.description",
        },
        () => openSession(ctx, state, true, "sounds"),
      );
    },
    async stop() {},
  });
}

export default register;
