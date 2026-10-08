/**
 * A client's box, read on its own several ways, set against the page's own
 * reading. Every number here is invented.
 */

import { describe, expect, it } from 'vitest';
import { withBoxReadings } from '../../src/core/analyze.js';
import { groupPages } from '../../src/core/group.js';
import { buildKnownList } from '../../src/core/knownList.js';
import { reviewReason } from '../../src/core/review.js';
import { verifyGroups } from '../../src/core/verify.js';

const zoneHit = (value) => ({ value, label: 'Hollowpine Joinery', source: 'zone' });
const box = (...values) => ({
  name: 'Hollowpine Joinery',
  readings: values.map((value) => ({ value, confidence: value ? 90 : null })),
});

describe('readings of the box on its own', () => {
  it('back up the page when they read the same number', () => {
    const result = withBoxReadings([zoneHit('HP-81450')], box('HP-81450', 'HP-81450', null));
    expect(result).toEqual({ candidates: [zoneHit('HP-81450')], agree: true, confidence: 90 });
  });

  it('stand in for the page when it found nothing there and they agree with each other', () => {
    const result = withBoxReadings([], box('HP-81450', 'HP-81450', 'HP-81450'));
    expect(result.candidates[0]).toEqual(zoneHit('HP-81450'));
    expect(result.agree).toBe(true);
  });

  it('do not count as agreeing when only one of them read anything', () => {
    expect(withBoxReadings([], box('HP-81450', null, null)).agree).toBe(false);
  });

  it('are all shown, never chosen between, when they disagree', () => {
    const result = withBoxReadings([zoneHit('S0-80155')], box('SO-80155', 'S0-80155', 'SO-80155'));
    expect(result.agree).toBe(false);
    expect(result.candidates.map((hit) => [hit.value, hit.source])).toEqual([
      ['S0-80155', 'zone'],
      ['SO-80155', 'box-crop'],
    ]);
  });

  it('change nothing when none of them read anything', () => {
    const candidates = [zoneHit('HP-81450')];
    expect(withBoxReadings(candidates, box(null, null, null))).toEqual({
      candidates,
      agree: false,
      confidence: null,
    });
  });
});

describe('readings that disagree', () => {
  const page = {
    index: 1,
    fileName: 'scan.pdf',
    text: 'Invoice No: S0-80155',
    ocr: true,
    matchedProfiles: [],
    detection: { ...zoneHit('S0-80155'), confidence: 88 },
    candidates: [
      zoneHit('S0-80155'),
      { value: 'SO-80155', label: 'the box, read larger', source: 'box-crop' },
    ],
    conflict: true,
  };

  it('are flagged with every reading named', () => {
    const { groups } = verifyGroups(groupPages([page]));
    expect(groups[0].flags).toContain('conflict');
    expect(reviewReason('conflict', groups[0])).toBe(
      'Page 1 gives two different numbers: S0-80155 (in the box you drew) and SO-80155 (the box, read larger). S0-80155 was used.'
    );
  });

  it('are settled by the invoice list when it has exactly one of them', () => {
    const list = buildKnownList([['SO-80155']], { invoiceColumn: 0, hasHeader: false });
    const { groups } = verifyGroups(groupPages([page]), { knownList: list });
    expect(groups[0]).toMatchObject({
      invoice: 'SO-80155',
      correctedFrom: 'S0-80155',
      verified: true,
      flags: [],
    });
  });
});
