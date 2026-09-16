import { renderAnalyze } from './src/report';
import type { AnalyzeResult } from './src/analyze';
import {
  disclosurePlausibility,
  dynamicStateValidity,
  personaFidelity,
  type StateTransition,
} from './src/metrics';
import { checkNeutrality } from './src/neutrality';

// The console report is what anyone actually reads, so the things the rates
// cannot say on their own — which transition was wrong, which constraint was
// held out, which verdict had nothing behind it — are asserted here rather than
// left to be noticed in a run.
function buildResult(over: Partial<AnalyzeResult> = {}): AnalyzeResult {
  return {
    source: 'bundle',
    counts: {
      conversations: 1,
      conversationsJudged: 1,
      decisions: 0,
      stateEvents: 3,
      charactersSeen: 1,
      unknownAuthors: [],
    },
    capabilityNotes: [],
    neutrality: checkNeutrality(),
    evidence: {
      opportunities: [],
      rejectedOpportunities: [],
      fidelity: [],
      disclosure: [],
      premature: [],
    },
    ...over,
  };
}

const transition = (over: Partial<StateTransition> = {}): StateTransition => ({
  characterName: 'Ratna',
  at: Date.parse('2026-09-11T00:00:00.000Z'),
  cause: 'conversationFeelings',
  component: 'mood',
  valueBefore: 60,
  valueAfter: 48,
  baseline: 50,
  expected: 'up',
  crossScenario: false,
  ...over,
});

describe('the report shows the evidence behind a failing rate', () => {
  test('a wrong-direction transition is named, with its event and both values', () => {
    const text = renderAnalyze(
      buildResult({
        dynamicState: dynamicStateValidity(
          [transition({ scenarioId: 's:12', conversationId: 'c:2369' }), transition({ at: 2, valueAfter: 72 })],
          { resetThreshold: 25, validResetCauses: [] },
        ),
      }),
    );
    expect(text).toContain('transitions counted against accuracy (1)');
    expect(text).toContain('wrong-direction');
    expect(text).toContain('Ratna');
    expect(text).toContain('60 to 48');
    expect(text).toContain("on 'conversationFeelings', expected up");
    expect(text).toContain('s:12');
    expect(text).toContain('c:2369');
  });

  test('a clean state log prints no failure list at all', () => {
    const text = renderAnalyze(
      buildResult({
        dynamicState: dynamicStateValidity([transition({ valueAfter: 72 })], {
          resetThreshold: 25,
          validResetCauses: [],
        }),
      }),
    );
    expect(text).toContain('State-Transition Accuracy');
    expect(text).not.toContain('transitions counted against accuracy');
  });

  test('withdrawn verdicts are reported beside the abstention rate', () => {
    const fidelity = [
      {
        characterName: 'Yvonne',
        conversationId: 'c1',
        kind: 'hardConstraint' as const,
        verdict: 'unclear' as const,
        statedVerdict: 'consistent' as const,
        attribute: 'Vegetarian on observance days',
        evidence: '',
        support: 'none' as const,
      },
    ];
    const text = renderAnalyze(
      buildResult({
        personaFidelity: personaFidelity(fidelity),
        evidence: {
          opportunities: [],
          rejectedOpportunities: [],
          fidelity,
          disclosure: [],
          premature: [],
        },
      }),
    );
    expect(text).toContain('withdrawn for no quoted behaviour');
    expect(text).toContain('judge said consistent: 1');
  });

  test('a constraint held out as not live says so, with what made it conditional', () => {
    const text = renderAnalyze(
      buildResult({
        disclosure: disclosurePlausibility([], []),
        evidence: {
          opportunities: [],
          rejectedOpportunities: [
            {
              characterName: 'Irina',
              conversationId: 'c1',
              attribute: 'Dietary rule',
              reason: 'condition-not-active',
              detail: 'conditional on "during fasting periods"; nothing establishes it applies now',
            },
          ],
          fidelity: [],
          disclosure: [],
          premature: [],
        },
      }),
    );
    expect(text).toContain('condition-not-active: 1');
    expect(text).toContain('not live: Irina');
    expect(text).toContain('during fasting periods');
  });

  test('repeat mentions folded into one episode are declared', () => {
    const mention = (messageIndex: number) => ({
      characterName: 'Ratna',
      conversationId: 'c1',
      constraint: 'Halal only — no pork',
      opportunity: true,
      disclosed: false,
      messageIndex,
    });
    const text = renderAnalyze(
      buildResult({
        disclosure: disclosurePlausibility([mention(1), mention(2), mention(3)], []),
      }),
    );
    expect(text).toContain('repeat mentions folded into their first opportunity: 2');
    expect(text).toContain('1 disclosure episodes counted');
    expect(text).toContain('(raised 3x)');
  });
});
