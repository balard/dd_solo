"""Unit name tables for the starter set.

Names are transcribed from the species pages of the starter rulebook
(docs/rules/starter-treefolk-vs-firewalkers.pdf). Order within each class is
small (1 health), medium (2), large (3), monster (4).
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
}

# Normal action icons. Anything else parsed off a face is treated as an SAI.
NORMAL_ICONS = {"ID", "MELEE", "MISSILE", "MAGIC", "SAVE", "MANEUVER"}

# The 25 SAIs documented in the starter rulebook (pp. 10-11). The starter set's two
# species between them use exactly this set, so an SAI name outside it is a typo.
KNOWN_SAIS = {
    "Bullseye", "Cantrip", "Choke", "Confuse", "Counter", "Create Fireminions",
    "Dispel Magic", "Double Strike", "Firecloud", "Firewalking", "Flame", "Fly",
    "Galeforce", "Hoof", "Rend", "Rise from the Ashes", "Seize", "Sleep", "Smite",
    "Smother", "Surprise", "Teleport", "Trample", "Volley", "Wild Growth",
}
