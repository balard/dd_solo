"""Unit name tables, one entry per species the data carries.

Treefolk and Firewalkers are transcribed from the species pages of the starter
rulebook (docs/rules/starter-treefolk-vs-firewalkers.pdf); later species from the
v4.01 rosters (docs/rules/dragon-dice-v4.01-full-rules.pdf, pp. 68-92). Order
within each class is small (1 health), medium (2), large (3), monster (4).

A species here is imported into units.json; a raw file with no entry here is not.
Being in the data does not make a species playable: the engine offers it only once
every SAI on its dice resolves and its abilities are known (src/engine/playable.ts).
"""

SIZES = [("small", 1, 6), ("medium", 2, 6), ("large", 3, 6), ("monster", 4, 10)]

CLASSES = ["heavy", "light", "cavalry", "missile", "magic"]

CLASS_LABELS = {
    "heavy": "heavy_melee",
    "light": "light_melee",
    "cavalry": "cavalry",
    "missile": "missile",
    "magic": "magic",
}

SPECIES = {
    "treefolk": {
        "name": "Treefolk",
        "elements": ["water", "earth"],
        "units": {
            "heavy":   ["Oakling", "Oak", "Oak Lord", "Darktree"],
            "light":   ["Willowling", "Willow", "Noble Willow", "Redwood"],
            "cavalry": ["Nymph", "Naiad", "Lady Nereid", "Satyr"],
            "missile": ["Pineling", "Pine", "Pine Prince", "Strangle Vine"],
            "magic":   ["Hamadryad", "Dryad", "Eldar Dryad", "Unicorn"],
        },
    },
    "firewalkers": {
        "name": "Firewalkers",
        "elements": ["air", "fire"],
        "units": {
            "heavy":   ["Guardian", "Watcher", "Sentinel", "Fireshadow"],
            "light":   ["Explorer", "Adventurer", "Expeditioner", "Genie"],
            "cavalry": ["Shadowchaser", "Nightsbane", "Daybringer", "Gorgon"],
            "missile": ["Firestarter", "Firemaster", "Firestormer", "Phoenix"],
            "magic":   ["Sunburst", "Sunflare", "Ashbringer", "Salamander"],
        },
    },
    # v4.01 p. 70. The Frontier-proposal draw and the home terrain derive from the
    # elements, so air & water makes Coastland their own type.
    "coral_elves": {
        "name": "Coral Elves",
        "elements": ["air", "water"],
        "units": {
            "heavy":   ["Fighter", "Trooper", "Protector", "Coral Giant"],
            "light":   ["Guard", "Courier", "Herald", "Gryphon"],
            "cavalry": ["Horseman", "Knight", "Eagle Knight", "Leviathan"],
            "missile": ["Bowman", "Archer", "Sharpshooter", "Sprite Swarm"],
            "magic":   ["Evoker", "Conjurer", "Enchanter", "Tako"],
        },
    },
    # v4.01 p. 72. Fire & earth makes Highland their own type, so both species
    # abilities are live at home. 'Crack-Shot' is the roster's spelling.
    "dwarves": {
        "name": "Dwarves",
        "elements": ["fire", "earth"],
        "units": {
            "heavy":   ["Footman", "Sergeant", "Warlord", "Androsphinx"],
            "light":   ["Sentry", "Patroller", "Skirmisher", "Behemoth"],
            "cavalry": ["Pony Rider", "Lizard Rider", "Mammoth Rider", "Gargoyle"],
            "missile": ["Crossbowman", "Marksman", "Crack-Shot", "Roc"],
            "magic":   ["Theurgist", "Thaumaturgist", "Wizard", "Umber Hulk"],
        },
    },
    # v4.01 p. 82. Death & earth: no terrain type in scope carries death, so they have
    # no own type and draw a home among the earth dice (setup.ts, drawHomeDie).
    "goblins": {
        "name": "Goblins",
        "elements": ["death", "earth"],
        "units": {
            "heavy":   ["Thug", "Cutthroat", "Marauder", "Cannibal"],
            "light":   ["Mugger", "Ambusher", "Filcher", "Death Naga"],
            "cavalry": ["Wardog Rider", "Wolf Rider", "Leopard Rider", "Harpy"],
            "missile": ["Pelter", "Slingman", "Deadeye", "Shambler"],
            "magic":   ["Trickster", "Hedge Wizard", "Death Mage", "Troll"],
        },
    },
    # v4.01 p. 84. Death & fire: like the Goblins they have no own type, so their home
    # is drawn among the fire dice. p. 84 prints 'Dead-Shot'; the id is dead_shot either way.
    "lava_elves": {
        "name": "Lava Elves",
        "elements": ["death", "fire"],
        "units": {
            "heavy":   ["Bladesman", "Duelist", "Conqueror", "Beholder"],
            "light":   ["Scout", "Spy", "Infiltrator", "Drider"],
            "cavalry": ["Spider Rider", "Scorpion Knight", "Wyvern Rider", "Hell Hound"],
            "missile": ["Fusilier", "Dead Shot", "Assassin", "Lurker in the Deep"],
            "magic":   ["Adept", "Warlock", "Necromancer", "Rakshasa"],
        },
    },
}

# Normal action icons. Anything else parsed off a face is treated as an SAI.
NORMAL_ICONS = {"ID", "MELEE", "MISSILE", "MAGIC", "SAVE", "MANEUVER"}

# The 25 SAIs documented in the starter rulebook (pp. 10-11). The starter set's two
# species between them use exactly this set.
STARTER_SAIS = {
    "Bullseye", "Cantrip", "Choke", "Confuse", "Counter", "Create Fireminions",
    "Dispel Magic", "Double Strike", "Firecloud", "Firewalking", "Flame", "Fly",
    "Galeforce", "Hoof", "Rend", "Rise from the Ashes", "Seize", "Sleep", "Smite",
    "Smother", "Surprise", "Teleport", "Trample", "Volley", "Wild Growth",
}

# The SAIs each later species adds, from its v4.01 species page. Only species with an
# entry above belong here: the list is what tells a typo from a new SAI.
SPECIES_SAIS = {
    "coral_elves": {"Entangle", "Ferry", "Hypnotic Glare", "Swallow", "Tail", "Wave"},  # p. 71
    "dwarves": {"Bash", "Charge", "Roar", "Stomp"},  # p. 73
    "goblins": {"Net", "Poison", "Regenerate", "Screech", "Stun"},  # p. 83
    "lava_elves": {"Charm", "Cloak", "Illusion", "Stone", "Web"},  # p. 85
}

# Every SAI name a face may carry; anything else parsed off a face is a typo.
KNOWN_SAIS = STARTER_SAIS.union(*SPECIES_SAIS.values())
