"""CBSE class 10, 2026-27: Mathematics (Standard), Science, Social Science."""

import sys

sys.path.insert(0, "lib")
from build import doc, ref, syllabus, topic, unit, write

FW = {
    "framework_id": "cbse",
    "framework_name": "Central Board of Secondary Education",
    "framework_kind": "national",
    "country": "IN",
    "version": "2026-27",
    "aliases": ["CBSE", "Central Board of Secondary Education, New Delhi"],
}
PUB = "Central Board of Secondary Education"

# ================================================================ mathematics
DM = doc("cbse_10_maths", "Mathematics, Class X, Secondary Curriculum Part 1, 2026-27", PUB)
M = "cbse-10-maths"
U = [
    (
        "NUMBER SYSTEMS",
        6,
        3,
        [
            (
                "REAL NUMBERS",
                3,
                [
                    "Fundamental Theorem of Arithmetic - statements after reviewing work done earlier and after illustrating and motivating through examples",
                    "Proofs of irrationality of √2, √3, √5",
                ],
                [
                    "Develops understanding of numbers, including the set of real numbers and its properties",
                    "Extends the understanding of powers (radical powers) and exponents",
                    "Applies Fundamental Theorem of Arithmetic to solve problems related to real life contexts",
                ],
            )
        ],
    ),
    (
        "ALGEBRA",
        20,
        3,
        [
            (
                "POLYNOMIALS",
                3,
                [
                    "Zeros of a polynomial",
                    "Relationship between zeros and coefficients of quadratic polynomials",
                ],
                [
                    "Develops a relationship between algebraic and graphical methods of finding the zeroes of a polynomial"
                ],
            ),
            (
                "PAIR OF LINEAR EQUATIONS IN TWO VARIABLES",
                3,
                [
                    "Pair of linear equations in two variables and graphical method of their solution, consistency/inconsistency",
                    "Algebraic conditions for number of solutions",
                    "Solution of a pair of linear equations in two variables algebraically - by substitution, by elimination",
                ],
                [
                    "Describes plotting a pair of linear equations and graphically finding the solution",
                    "Models and solves contextualised problems using equations (e.g., simultaneous linear equations in two variables)",
                ],
            ),
            (
                "QUADRATIC EQUATIONS",
                4,
                [
                    "Standard form of a quadratic equation ax² + bx + c = 0, (a ≠ 0)",
                    "Solutions of quadratic equations (only real roots) by factorization, and by using quadratic formula. Relationship between discriminant and nature of roots",
                    "Situational problems based on quadratic equations related to day-to-day activities to be incorporated",
                ],
                [
                    "Demonstrates strategies of finding roots and determining the nature of roots of a quadratic equation"
                ],
            ),
            (
                "ARITHMETIC PROGRESSIONS",
                4,
                [
                    "Motivation for studying Arithmetic Progression",
                    "Derivation of the nth term and sum of the first n terms of AP and their application in solving daily life problems",
                ],
                ["Develops strategies to apply the concept of A.P. to daily life situations"],
            ),
        ],
    ),
    (
        "COORDINATE GEOMETRY",
        6,
        5,
        [
            (
                "Coordinate Geometry",
                5,
                [
                    "Review: Concepts of coordinate geometry. Distance formula. Section formula (internal division)"
                ],
                [
                    "Derives formulae to establish relations for geometrical shapes in the context of a coordinate plane, such as, finding the distance between two given points, to determine the coordinates of a point between any two given points"
                ],
            )
        ],
    ),
    (
        "GEOMETRY",
        15,
        5,
        [
            (
                "TRIANGLES",
                5,
                [
                    "Definitions, examples, counter examples of similar triangles",
                    "(Prove) If a line is drawn parallel to one side of a triangle to intersect the other two sides in distinct points, the other two sides are divided in the same ratio",
                    "State (without proof) If a line divides two sides of a triangle in the same ratio, the line is parallel to the third side",
                    "State (without proof) If in two triangles, the corresponding angles are equal, their corresponding sides are proportional and the triangles are similar",
                    "State (without proof) If the corresponding sides of two triangles are proportional, their corresponding angles are equal and the two triangles are similar",
                    "State (without proof) If one angle of a triangle is equal to one angle of another triangle and the sides including these angles are proportional, the two triangles are similar",
                ],
                [
                    "Works out ways to differentiate between congruent and similar figures",
                    "Establishes properties for similarity of two triangles logically using different geometric criteria established earlier such as, Basic Proportionality Theorem, etc.",
                ],
            ),
            (
                "CIRCLES",
                5,
                [
                    "Tangent to a circle at point of contact",
                    "(Prove) The tangent at any point of a circle is perpendicular to the radius through the point of contact",
                    "(Prove) The lengths of tangents drawn from an external point to a circle are equal",
                ],
                ["Derives proofs of theorems related to the tangents of circles"],
            ),
        ],
    ),
    (
        "TRIGONOMETRY",
        12,
        6,
        [
            (
                "INTRODUCTION TO TRIGONOMETRY",
                6,
                [
                    "Trigonometric ratios of an acute angle of a right-angled triangle. Proof of their existence (well defined)",
                    "Motivate the ratios whichever are defined at 0° and 90°. Values of the trigonometric ratios of 30°, 45° and 60°",
                    "Relationships between the ratios",
                ],
                [
                    "Understands the definitions of the basic trigonometric functions (including the introduction of the sine and cosine functions)"
                ],
            ),
            (
                "TRIGONOMETRIC IDENTITIES",
                6,
                [
                    "Proof and applications of the identity sin² A + cos² A = 1",
                    "Only simple identities to be given",
                ],
                ["Uses Trigonometric identities to solve problems"],
            ),
            (
                "HEIGHTS AND DISTANCES: Angle of elevation, Angle of Depression",
                6,
                [
                    "Simple problems on heights and distances. Problems should not involve more than two right triangles. Angles of elevation / depression should be only 30°, 45°, and 60°"
                ],
                [
                    "Applies Trigonometric ratios in solving problems in daily life contexts like finding heights of different structures or distance from them"
                ],
            ),
        ],
    ),
    (
        "MENSURATION",
        10,
        7,
        [
            (
                "AREAS RELATED TO CIRCLES",
                7,
                [
                    "Area of sectors and segments of a circle",
                    "Problems based on areas and perimeter/circumference of the above said plane figures. (In calculating area of segment of a circle, problems should be restricted to central angle of 60°, 90° and 120° only)",
                ],
                ["Derives and uses formulae to calculate areas of plane figures"],
            ),
            (
                "SURFACE AREAS AND VOLUMES",
                7,
                [
                    "Surface areas and volumes of combinations of any two of the following: cubes, cuboids, spheres, hemispheres and right circular cylinders/cones"
                ],
                [
                    "Visualises and uses mathematical thinking to discover formulae to calculate surface areas and volumes of solid objects (cubes, cuboids, spheres, hemispheres, right circular cylinders/cones, and their combinations)"
                ],
            ),
        ],
    ),
    (
        "STATISTICS AND PROBABILITY",
        11,
        7,
        [
            (
                "STATISTICS",
                7,
                ["Mean, median and mode of grouped data (bimodal situation to be avoided)"],
                [
                    "Calculates mean, median and mode for different sets of data related with real life contexts"
                ],
            ),
            (
                "PROBABILITY",
                7,
                [
                    "Classical definition of probability",
                    "Simple problems on finding the probability of an event",
                ],
                [
                    "Applies concepts from probability to solve problems on the likelihood of everyday events"
                ],
            ),
        ],
    ),
]
units = []
for i, (name, marks, _page, items) in enumerate(U, 1):
    tops = []
    for tname, tpage, contents, comps in items:
        tops.append(
            topic(
                tname,
                objectives=comps,
                source_ref=ref(M, page=tpage, section=f"Unit {i}: {name}"),
                contents=contents,
            )
        )
    units.append(
        unit(
            name,
            ref(M, page=2, section=f"Course structure Class X, unit {i}"),
            topics=tops,
            marks=marks,
        )
    )
write(
    "cbse/class-10-mathematics.json",
    syllabus(
        **FW,
        level="Class 10",
        level_order=10,
        subject="Mathematics",
        status="verified",
        documents=[DM],
        units=units,
        note="Units and marks are the course structure on page 2. Each topic's `contents` are the "
        "document's numbered content entries and its `objectives` are the document's own "
        "competencies column, verbatim. The document covers Mathematics Standard (041); the "
        "Basic (241) paper is the same syllabus with a different question paper design.",
    ),
)

# ================================================================ science
DS = doc("cbse_10_science", "Science, Class X, Secondary Curriculum Part 1, 2026-27", PUB)
S = "cbse-10-science"
# What the document says about how a topic is assessed, in its own words and with its page.
# Read off the rendered pages on 2026-09-05, not off the text layer: pdftotext -layout indents the
# whole of page 6 by one space, and the first cut took that indent for the formative box and so
# marked the human eye and the prism (Unit III, examined) and Acids, Bases and Salts (Unit I,
# examined, with three practicals under it) as formative only. The boxes the document draws hold
# exactly three topics, and its Note for Teachers on page 6 names what is not examined.
BOX = (
    "Printed on page {box} inside the box headed 'The following topics are included in the "
    "syllabus but will be assessed only formatively to reinforce understanding without adding "
    "to summative assessments'. {note}"
)
NOTE_NAMED = (
    "The Note for Teachers on page 6 lists it among the topics that 'will not be assessed in "
    "the year-end examination'."
)
NOTE_MOTOR = (
    "The Note for Teachers on page 6 names its third unassessed topic as 'Electric Effects of "
    "Electric Current', a name the syllabus prose does not use; the box on page 6 is the only "
    "Unit IV material stated as formative."
)
HEREDITY = (
    "The syllabus prose on page 5 prints this topic outside the formative-only box, and the box "
    "under it names Evolution alone; the Note for Teachers on page 6 lists 'Heredity and "
    "Evolution' among the topics that 'will not be assessed in the year-end examination'. The "
    "document does not resolve the two, and this file records both rather than choosing."
)
# (unit name, marks, theme, [(topic, contents, page, assessment)]). Pages are the physical pages
# pdftotext and pypdf count: the course structure is page 4, the prose runs pages 4 to 6.
SU = [
    (
        "Chemical Substances - Nature and Behaviour",
        25,
        "Materials",
        [
            (
                "Chemical Reactions and Equations",
                "Chemical reactions, Chemical equation, Balanced chemical equation, types of chemical reactions: combination, decomposition, displacement, double displacement, precipitation, endothermic exothermic reactions, oxidation and reduction.",
                4,
                None,
            ),
            (
                "Periodic Classification of Elements",
                "Döbereiner's Triads, Newlands' Law of Octaves, Mendeléev's Periodic Table, Modern Periodic Table and the Modern, Metallic and Non-metallic Properties.",
                4,
                BOX.format(box=4, note=NOTE_NAMED),
            ),
            (
                "Acids, Bases and Salts",
                "Acids and Bases - definitions in terms of furnishing of H+ and OH- ions, identification using indicators, chemical properties, examples and uses, neutralization, concept of pH scale (Definition relating to logarithm not required), importance of pH in everyday life; preparation and uses of Sodium Hydroxide, Bleaching Powder, Baking soda, Washing soda and Plaster of Paris.",
                4,
                None,
            ),
            (
                "Metals and Non-metals",
                "Properties of metals and non-metals; Reactivity series; Formation and properties of ionic compounds; Basic metallurgical processes; Corrosion and its prevention.",
                5,
                None,
            ),
            (
                "Carbon and its Compounds",
                "Covalent bonds - formation and properties of covalent compounds, Versatile nature of carbon, Hydrocarbons - saturated and unsaturated Homologous series. Nomenclature of alkanes, alkenes, alkyne and carbon compounds containing functional groups (halogens, alcohol, ketones, aldehydes). Chemical properties of carbon compounds (combustion, oxidation, addition and substitution reaction). Ethanol and Ethanoic acid (only properties and uses), soaps and detergents.",
                5,
                None,
            ),
        ],
    ),
    (
        "World of Living",
        25,
        "The World of the Living",
        [
            (
                "Life processes",
                "'Living Being'. Basic concept of nutrition, respiration, transport and excretion in plants and animals.",
                5,
                None,
            ),
            (
                "Control and co-ordination in animals and plants",
                "Tropic movements in plants; Introduction of plant hormones; Control and co-ordination in animals: Nervous system; Voluntary, involuntary and reflex action; Chemical co-ordination: animal hormones.",
                5,
                None,
            ),
            (
                "Reproduction",
                "Reproduction in animals and plants (asexual and sexual) reproductive health - need and methods of family planning. Safe sex vs HIV/AIDS. Child bearing and women's health.",
                5,
                None,
            ),
            (
                "Heredity",
                "Heredity; Mendel's contribution - Laws for inheritance of traits: Sex determination; brief introduction.",
                5,
                HEREDITY,
            ),
            (
                "Evolution",
                "Acquired and Inherited Traits, Speciation, Evolution and Classification, Tracing Evolutionary Relationships, Fossils, Evolution by Stages, Human Evolution.",
                5,
                BOX.format(box=5, note=NOTE_NAMED),
            ),
        ],
    ),
    (
        "Natural Phenomena",
        12,
        "Natural Phenomena",
        [
            (
                "Reflection of light by curved surfaces",
                "Images formed by spherical mirrors, centre of curvature, principal axis, principal focus, focal length, mirror formula (Derivation not required), magnification.",
                5,
                None,
            ),
            ("Refraction", "Laws of refraction, refractive index.", 5, None),
            (
                "Refraction of light by spherical lens",
                "Image formed by spherical lenses; Lens formula (Derivation not required); Magnification. Power of a lens.",
                5,
                None,
            ),
            (
                "Functioning of a lens in human eye",
                "Defects of vision and their corrections, applications of spherical mirrors and lenses.",
                6,
                None,
            ),
            (
                "Refraction of light through a prism",
                "Dispersion of light, scattering of light, applications in daily life (excluding colour of the sun at sunrise and sunset).",
                6,
                None,
            ),
        ],
    ),
    (
        "Effects of Current",
        13,
        "How Things Work",
        [
            (
                "Electric current",
                "Electric current, potential difference and electric current. Ohm's law; Resistance, Resistivity, Factors on which the resistance of a conductor depends. Series combination of resistors, parallel combination of resistors and its applications in daily life. Heating effect of electric current and its applications in daily life. Electric power, Interrelation between P, V, I and R.",
                6,
                None,
            ),
            (
                "Magnetic effects of current",
                "Magnetic field, field lines, field due to a current carrying conductor, field due to current carrying coil or solenoid; Force on current carrying conductor, Fleming's Left Hand Rule, Direct current. Alternating current: frequency of AC. Advantage of AC over DC. Domestic electric circuits.",
                6,
                None,
            ),
            (
                "Motor, Electromagnetic Induction, Electric Generator",
                "",
                6,
                BOX.format(box=6, note=NOTE_MOTOR),
            ),
        ],
    ),
    (
        "Natural Resources",
        5,
        "Natural Resources",
        [
            (
                "Our environment",
                "Eco-system, Environmental problems, Ozone depletion, waste production and their solutions. Biodegradable and non-biodegradable substances.",
                6,
                None,
            )
        ],
    ),
]
units = []
for i, (name, marks, theme, items) in enumerate(SU, 1):
    tops = []
    for tname, contents, page, assessment in items:
        kw = {}
        if contents:
            kw["contents"] = contents
        if assessment:
            kw["assessment"] = assessment
        tops.append(topic(tname, source_ref=ref(S, page=page, section=f"Unit {i}: {name}"), **kw))
    units.append(
        unit(
            name,
            ref(S, page=4, section=f"Course structure Class X, unit {i}"),
            topics=tops,
            marks=marks,
            theme=theme,
        )
    )
write(
    "cbse/class-10-science.json",
    syllabus(
        **FW,
        level="Class 10",
        level_order=10,
        subject="Science",
        status="verified",
        documents=[DS],
        units=units,
        note="Units, themes and marks are the course structure on page 4; topics and their contents "
        "are the syllabus prose on pages 4 to 6, verbatim, cited to the page each topic starts "
        "on. The document states curricular goals and competencies for the whole subject "
        "(pages 2 to 5) rather than per topic, so no per-topic objectives are recorded. "
        "`assessment` on a topic records, in the document's own words and with its page, "
        "what the document says about how that topic is assessed: three topics sit inside "
        "the boxes the document marks as assessed formatively only (Periodic Classification "
        "of Elements, Evolution, and Motor, Electromagnetic Induction, Electric Generator), "
        "and Heredity carries the document's own unresolved contradiction between its prose "
        "and its Note for Teachers. Everything else, Acids, Bases and Salts and the whole of "
        "Unit III included, is examined: the Note for Teachers on page 6 names exactly what "
        "is not, and the practicals list on pages 7 and 8 sets pH and acid-base experiments "
        "under Unit I. Pages are counted as pdftotext and pypdf count them.",
    ),
)

# ================================================================ social science
DSS = doc("cbse_10_social", "Social Science (087), Class X, 2026-27", PUB)
SS = "cbse-10-social"
SSU = [
    (
        "History (India and the Contemporary World-II)",
        20,
        1,
        [
            ("The Rise of Nationalism in Europe", "I", "I. Events and processes", None),
            ("Nationalism in India", "II", "I. Events and processes", None),
            (
                "The Making of a Global World",
                "III",
                "II. Livelihoods, Economies and Societies",
                "Subtopics 1 to 1.3, Pre Modern World to Conquest, disease and trade, are evaluated in the board examination; subtopics 2 to 4.4 are an interdisciplinary project assessed internally for 5 marks.",
            ),
            (
                "The Age of Industrialisation",
                "IV",
                "II. Livelihoods, Economies and Societies",
                "To be assessed as part of Periodic Assessment only.",
            ),
            (
                "Print Culture and the Modern world",
                "V",
                "III. Everyday Life, Culture and politics",
                None,
            ),
        ],
    ),
    (
        "Geography (Contemporary India-II)",
        20,
        1,
        [
            ("Resources and Development", "1", None, None),
            ("Forest and Wildlife Resources", "2", None, None),
            ("Water resources", "3", None, None),
            ("Agriculture", "4", None, None),
            ("Minerals and energy Resources", "5", None, None),
            ("Manufacturing Industries", "6", None, None),
            (
                "Lifelines of National Economy",
                "7",
                None,
                "Only map pointing to be evaluated in the board examination.",
            ),
        ],
    ),
    (
        "Political Science (Democratic Politics-II)",
        20,
        2,
        [
            ("Power-sharing", "1", "I", None),
            ("Federalism", "2", "I", None),
            ("Gender, Religion and Caste", "3", "II", None),
            ("Political Parties", "4", "III", None),
            ("Outcomes of Democracy", "5", "IV", None),
        ],
    ),
    (
        "Economics (Understanding Economic Development)",
        20,
        2,
        [
            ("Development", "1", None, None),
            ("Sectors of the Indian Economy", "2", None, None),
            ("Money and Credit", "3", None, None),
            (
                "Globalisation and the Indian Economy",
                "4",
                None,
                "What is Globalisation? and Factors that have enabled Globalisation are evaluated in the board examination; Production across the countries, Chinese toys in India, World Trade Organisation and The Struggle for a Fair Globalisation are an interdisciplinary project assessed internally for 5 marks.",
            ),
        ],
    ),
]
units = []
for _i, (name, marks, page, items) in enumerate(SSU, 1):
    tops = []
    for tname, chno, section, assess in items:
        kw = {"chapter_number": chno}
        if section:
            kw["section"] = section
        if assess:
            kw["assessment"] = assess
        tops.append(
            topic(tname, source_ref=ref(SS, page=page, section=f"Course structure, {name}"), **kw)
        )
    units.append(
        unit(name, ref(SS, page=page, section="Course structure"), topics=tops, marks=marks)
    )
write(
    "cbse/class-10-social-science.json",
    syllabus(
        **FW,
        level="Class 10",
        level_order=10,
        subject="Social Science",
        status="verified",
        documents=[DSS],
        units=units,
        note="Units are the four disciplines of the course structure with their prescribed NCERT "
        "book, topics are the prescribed chapters, and the marks are the document's own. Each "
        "unit carries 20 marks, of which History and Geography include map pointing "
        "(18 + 2 and 17 + 3). The document states no per-chapter learning objectives.",
    ),
)
