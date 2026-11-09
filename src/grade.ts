import { GRADE_RANK, type Grade } from './types.js';

export function gradeRank(grade: Grade): number {
  return GRADE_RANK[grade];
}

export function worstGrade(grades: Grade[]): Grade {
  let worst: Grade = 'LOCAL';
  for (const g of grades) {
    if (GRADE_RANK[g] > GRADE_RANK[worst]) worst = g;
  }
  return worst;
}

export function meetsThreshold(grade: Grade, threshold: Grade): boolean {
  return GRADE_RANK[grade] >= GRADE_RANK[threshold];
}
