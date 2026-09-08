// Standardized choice scenarios for Component 3.
//
// Distinct from the theory dimensions in registry.ts: these carry no hypothesis
// and no expected direction. Their job is only to put many NPCs in front of the
// same menu so Option Coverage and Within-Group Diversity have something to
// measure. Organic town chat never does that — two characters never face an
// identical set of candidate options — which is why the framework's diversity
// component cannot be computed from chat history alone.
//
// Each is written so that no option is obviously correct and none is ruled out
// for most people: a menu where three of four options are infeasible for
// everybody would report convergence that is really just constraint.

export type ChoiceProbe = {
  id: string;
  name: string;
  situation: string;
  options: { optionId: string; title: string; details: string }[];
};

export const CHOICE_PROBES: ChoiceProbe[] = [
  {
    id: 'weekend-outing',
    name: 'Weekend outing',
    situation:
      'A group you are part of is planning one shared outing this Saturday afternoon. Everyone ' +
      'is free, the weather is ordinary, and the group is waiting to hear what each person ' +
      'would prefer. Four suggestions are on the table.',
    options: [
      {
        optionId: 'botanic',
        title: 'Botanic Gardens walk',
        details:
          'A slow loop through the gardens, then coffee at the visitor centre. Free entry, ' +
          'about S$6 for a drink. Outdoors, shaded in parts, two hours on your feet.',
      },
      {
        optionId: 'museum',
        title: 'National Museum',
        details:
          'The current exhibition, air-conditioned throughout, S$15 entry. Quiet, seated ' +
          'benches, about two hours, easy to leave early.',
      },
      {
        optionId: 'hawker',
        title: 'Long lunch at Tekka',
        details:
          'A big shared table at the hawker centre, everyone orders what they want. About ' +
          'S$8 a head, noisy and lively, no fixed end time.',
      },
      {
        optionId: 'beach',
        title: 'East Coast Park',
        details:
          'Rent bicycles along the coast, then a drink at one of the beachfront places. ' +
          'About S$20 a head, hot and open, three hours including travel.',
      },
    ],
  },
  {
    id: 'colleague-gift',
    name: 'Leaving gift for a colleague',
    situation:
      'A colleague you all get along with is leaving at the end of the month. The group is ' +
      'deciding on one leaving present, and everyone will chip in the same amount. Four ' +
      'suggestions have been put forward and the group wants each person to say which they back.',
    options: [
      {
        optionId: 'voucher',
        title: 'A department store voucher',
        details: 'S$20 each into a S$120 voucher. Impersonal but certain to be used.',
      },
      {
        optionId: 'dinner',
        title: 'A farewell dinner',
        details:
          'A booked table at a mid-range restaurant, S$45 a head, drinks extra and ordered ' +
          'to the table.',
      },
      {
        optionId: 'photobook',
        title: 'A printed photo book',
        details:
          'Photos and a written note from everyone, about S$10 each. Takes an evening of ' +
          'group time to put together.',
      },
      {
        optionId: 'donation',
        title: 'A donation in their name',
        details: 'S$20 each to a charity they have mentioned, with a card. No physical gift.',
      },
    ],
  },
  {
    id: 'shared-flat',
    name: 'Sorting out a shared cost',
    situation:
      'You share a flat with several others. The aircon in the shared living room has failed ' +
      'and needs replacing. Nothing anyone did caused it. The group is deciding how to handle the ' +
      'S$1,200 cost, and each person is being asked which way they would go.',
    options: [
      {
        optionId: 'equal',
        title: 'Split it equally',
        details: 'Everyone pays the same share, regardless of income or how much they use it.',
      },
      {
        optionId: 'usage',
        title: 'Split it by use',
        details:
          'Whoever spends more time in the living room pays more. Requires agreeing who that is.',
      },
      {
        optionId: 'income',
        title: 'Split it by income',
        details: 'Those earning more pay a larger share. Requires people saying what they earn.',
      },
      {
        optionId: 'landlord',
        title: 'Push it to the landlord',
        details:
          'Refuse to pay and insist the landlord covers it. Free if it works, but it may take ' +
          'weeks and sour the relationship.',
      },
    ],
  },
];

export function probeById(id: string): ChoiceProbe | undefined {
  return CHOICE_PROBES.find((p) => p.id === id);
}
