import { useState, useMemo } from "react";

// ═══════════════════════════════════════════════════════════════════
// 2026 TAX PARAMETERS
// ═══════════════════════════════════════════════════════════════════
const FED_BRACKETS = [
  { limit: 58523, rate: 0.14, label: "14% on first $58,523" },
  { limit: 117045, rate: 0.205, label: "20.5% on $58,523–$117,045" },
  { limit: 181440, rate: 0.26, label: "26% on $117,045–$181,440" },
  { limit: 258482, rate: 0.29, label: "29% on $181,440–$258,482" },
  { limit: Infinity, rate: 0.33, label: "33% on $258,482+" },
];
const FED_BPA = 16452;
const FED_LOWEST_RATE = 0.14;

const BC_BRACKETS = [
  { limit: 50363, rate: 0.056, label: "5.60% on first $50,363" },
  { limit: 100728, rate: 0.077, label: "7.70% on $50,363–$100,728" },
  { limit: 115648, rate: 0.105, label: "10.50% on $100,728–$115,648" },
  { limit: 140430, rate: 0.1229, label: "12.29% on $115,648–$140,430" },
  { limit: 190405, rate: 0.147, label: "14.70% on $140,430–$190,405" },
  { limit: 265545, rate: 0.168, label: "16.80% on $190,405–$265,545" },
  { limit: Infinity, rate: 0.205, label: "20.50% on $265,545+" },
];
const BC_BPA = 13216;
const BC_LOWEST_RATE = 0.056;

const CORP_TAX_RATE = 0.11;
const CPP_BASIC_EXEMPTION = 3500;
const CPP_YMPE = 74600;
const CPP_RATE = 0.0595;
const CPP_MAX_EE = 4230.45;
const CPP2_YAMPE = 85000;
const CPP2_RATE = 0.04;
const CPP2_MAX_EE = 416.0;

const GROSS_UP = 0.15;
const FED_DTC = 0.090301;
const BC_DTC = 0.01952;

const CCB_U6 = 7997;
const CCB_617 = 6748;
const CCB_T1 = 37487;
const CCB_T2 = 81222;
const CCB_RATES = {
  1: { r1: 0.07, r2: 0.032 },
  2: { r1: 0.135, r2: 0.057 },
  3: { r1: 0.19, r2: 0.08 },
  4: { r1: 0.23, r2: 0.095 },
};

const BCFB_MAX = { 1: 1850, 2: 2975, 3: 3900 };
const BCFB_MIN = { 1: 375, 2: 675, 3: 925 };
const BCFB_T1 = 29526;
const BCFB_T2 = 94483;

const RRSP_RATE = 0.18;
const RRSP_MAX = 33810;

// ═══════════════════════════════════════════════════════════════════
// DETAILED CALCULATION FUNCTIONS (return traces)
// ═══════════════════════════════════════════════════════════════════
const F = (n) => {
  if (n == null || isNaN(n)) return "$0";
  const neg = n < 0;
  const abs = Math.abs(Math.round(n));
  return (neg ? "(" : "") + "$" + abs.toLocaleString("en-CA") + (neg ? ")" : "");
};
const Fd = (n) => "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const P = (n) => (n * 100).toFixed(2) + "%";

function bracketDetail(income, brackets) {
  const rows = [];
  let tax = 0, prev = 0;
  for (const b of brackets) {
    if (income <= prev) break;
    const amt = Math.min(income, b.limit) - prev;
    const t = amt * b.rate;
    rows.push({ label: b.label, amount: amt, rate: b.rate, tax: t });
    tax += t;
    prev = b.limit;
  }
  return { rows, total: tax };
}

function calcCPPDetail(salary) {
  if (salary <= CPP_BASIC_EXEMPTION) return { cpp1: 0, cpp2: 0, total: 0, trace: [] };
  const trace = [];
  const pe = Math.min(salary, CPP_YMPE) - CPP_BASIC_EXEMPTION;
  const cpp1 = Math.min(pe * CPP_RATE, CPP_MAX_EE);
  trace.push(`Pensionable: min(${F(salary)}, ${F(CPP_YMPE)}) − ${F(CPP_BASIC_EXEMPTION)} = ${F(pe)}`);
  trace.push(`CPP1: ${F(pe)} × ${P(CPP_RATE)} = ${Fd(cpp1)}`);
  let cpp2 = 0;
  if (salary > CPP_YMPE) {
    const e2 = Math.min(salary, CPP2_YAMPE) - CPP_YMPE;
    cpp2 = Math.min(e2 * CPP2_RATE, CPP2_MAX_EE);
    trace.push(`CPP2: min(${F(salary)}, ${F(CPP2_YAMPE)}) − ${F(CPP_YMPE)} = ${F(e2)}`);
    trace.push(`CPP2: ${F(e2)} × ${P(CPP2_RATE)} = ${Fd(cpp2)}`);
  }
  trace.push(`Total ee CPP: ${Fd(cpp1)} + ${Fd(cpp2)} = ${Fd(cpp1 + cpp2)}`);
  return { cpp1, cpp2, total: cpp1 + cpp2, trace };
}

function calcCCBDetail(afni, nU6, n617) {
  const tot = nU6 + n617;
  if (tot === 0) return { amount: 0, trace: [] };
  const maxB = nU6 * CCB_U6 + n617 * CCB_617;
  const trace = [];
  trace.push(`Max CCB: ${nU6} × ${F(CCB_U6)} + ${n617} × ${F(CCB_617)} = ${F(maxB)}`);
  if (afni <= CCB_T1) {
    trace.push(`Family AFNI ${F(afni)} ≤ ${F(CCB_T1)} → no clawback`);
    return { amount: maxB, trace };
  }
  const n = Math.min(tot, 4);
  const rates = CCB_RATES[n];
  let reduction = 0;
  if (afni <= CCB_T2) {
    reduction = (afni - CCB_T1) * rates.r1;
    trace.push(`AFNI ${F(afni)} in range ${F(CCB_T1)}–${F(CCB_T2)}`);
    trace.push(`Clawback: (${F(afni)} − ${F(CCB_T1)}) × ${P(rates.r1)} = ${F(reduction)}`);
  } else {
    const r1 = (CCB_T2 - CCB_T1) * rates.r1;
    const r2 = (afni - CCB_T2) * rates.r2;
    reduction = r1 + r2;
    trace.push(`AFNI ${F(afni)} exceeds ${F(CCB_T2)}`);
    trace.push(`Tier 1: (${F(CCB_T2)} − ${F(CCB_T1)}) × ${P(rates.r1)} = ${F(r1)}`);
    trace.push(`Tier 2: (${F(afni)} − ${F(CCB_T2)}) × ${P(rates.r2)} = ${F(r2)}`);
    trace.push(`Total clawback: ${F(r1)} + ${F(r2)} = ${F(reduction)}`);
  }
  const result = Math.max(0, maxB - reduction);
  trace.push(`Net CCB: ${F(maxB)} − ${F(reduction)} = ${F(result)}`);
  return { amount: result, trace };
}

function calcBCFBDetail(afni, totalKids) {
  if (totalKids === 0) return { amount: 0, trace: [] };
  const n = Math.min(totalKids, 3);
  const maxB = BCFB_MAX[n] || BCFB_MAX[3] + (totalKids - 3) * 925;
  const minB = BCFB_MIN[n] || BCFB_MIN[3] + (totalKids - 3) * 250;
  const trace = [];
  trace.push(`Max BCFB: ${F(maxB)} · Floor: ${F(minB)}`);
  if (afni <= BCFB_T1) {
    trace.push(`AFNI ≤ ${F(BCFB_T1)} → full benefit`);
    return { amount: maxB, trace };
  }
  if (afni <= BCFB_T2) {
    const red = (afni - BCFB_T1) * 0.04;
    const result = Math.max(minB, maxB - red);
    trace.push(`Clawback: (${F(afni)} − ${F(BCFB_T1)}) × 4% = ${F(red)}`);
    trace.push(`Net: max(${F(minB)}, ${F(maxB)} − ${F(red)}) = ${F(result)}`);
    return { amount: result, trace };
  }
  const red2 = (afni - BCFB_T2) * 0.04;
  const result = Math.max(0, minB - red2);
  trace.push(`Above ${F(BCFB_T2)}: ${F(minB)} − (${F(afni)} − ${F(BCFB_T2)}) × 4% = ${F(result)}`);
  return { amount: result, trace };
}

function spouseTax(inc) {
  const t = bracketDetail(inc, FED_BRACKETS);
  const tbc = bracketDetail(inc, BC_BRACKETS);
  const cpp = calcCPPDetail(inc);
  const fBPA = Math.min(t.total, FED_BPA * FED_LOWEST_RATE);
  const bBPA = Math.min(tbc.total, BC_BPA * BC_LOWEST_RATE);
  const cF = cpp.cpp1 * FED_LOWEST_RATE;
  const cB = cpp.cpp1 * BC_LOWEST_RATE;
  const tax = Math.max(0, t.total - fBPA - cF) + Math.max(0, tbc.total - bBPA - cB);
  return { tax, cpp: cpp.total, afterTax: inc - tax - cpp.total, afni: inc - cpp.cpp2 };
}

// ─── FULL STRATEGY WITH TRACE ──────────────────────────────────────

function salaryFull(grossSal, spouseInc, nU6, n617) {
  const totalKids = nU6 + n617;
  const sections = [];

  // 1. CORPORATE
  const cpp = calcCPPDetail(grossSal);
  const corpCost = grossSal + cpp.total;
  sections.push({ title: "1. Corporate Level", steps: [
    { label: "Gross salary", value: F(grossSal) },
    { label: "Employer CPP (matches employee)", value: Fd(cpp.total), sub: cpp.trace },
    { label: "Total corporate cost (fully deductible per s. 9/18(1)(a))", value: F(corpCost), bold: true },
    { label: "Corporate tax: $0 — salary is a deduction against active business income", note: true },
  ]});

  // 2. CPP EMPLOYEE
  sections.push({ title: "2. CPP — Employee", steps: [
    ...cpp.trace.map(t => ({ label: t })),
    { label: "", spacer: true },
    { label: "CPP1 → non-refundable credit at lowest rate (s. 118.7)", note: true },
    { label: "CPP2 → deduction from net income (s. 60(e.1)) — reduces AFNI", note: true },
  ]});

  // 3. PERSONAL TAX
  const taxInc = grossSal - cpp.cpp2;
  const fB = bracketDetail(taxInc, FED_BRACKETS);
  const bB = bracketDetail(taxInc, BC_BRACKETS);
  const fBPA = Math.min(fB.total, FED_BPA * FED_LOWEST_RATE);
  const bBPA = Math.min(bB.total, BC_BPA * BC_LOWEST_RATE);
  const cppCrF = cpp.cpp1 * FED_LOWEST_RATE;
  const cppCrB = cpp.cpp1 * BC_LOWEST_RATE;
  const fNet = Math.max(0, fB.total - fBPA - cppCrF);
  const bNet = Math.max(0, bB.total - bBPA - cppCrB);
  const pTax = fNet + bNet;

  const s3 = [];
  s3.push({ label: "Gross salary", value: F(grossSal) });
  if (cpp.cpp2 > 0) s3.push({ label: "Less: CPP2 deduction (s. 60(e.1))", value: `(${Fd(cpp.cpp2)})` });
  s3.push({ label: "Taxable income (line 26000)", value: F(taxInc), bold: true });
  s3.push({ label: "", spacer: true });
  s3.push({ label: "FEDERAL TAX", bold: true });
  fB.rows.forEach(r => s3.push({ label: `  ${F(r.amount)} × ${P(r.rate)}`, value: F(r.tax) }));
  s3.push({ label: "  Gross federal tax", value: F(fB.total), bold: true });
  s3.push({ label: `  Less: BPA credit ${F(FED_BPA)} × ${P(FED_LOWEST_RATE)}`, value: `(${F(fBPA)})` });
  s3.push({ label: `  Less: CPP1 credit ${Fd(cpp.cpp1)} × ${P(FED_LOWEST_RATE)}`, value: `(${F(cppCrF)})` });
  s3.push({ label: "  Net federal tax", value: F(fNet), bold: true });
  s3.push({ label: "", spacer: true });
  s3.push({ label: "BC TAX", bold: true });
  bB.rows.forEach(r => s3.push({ label: `  ${F(r.amount)} × ${P(r.rate)}`, value: F(r.tax) }));
  s3.push({ label: "  Gross BC tax", value: F(bB.total), bold: true });
  s3.push({ label: `  Less: BPA credit ${F(BC_BPA)} × ${P(BC_LOWEST_RATE)}`, value: `(${F(bBPA)})` });
  s3.push({ label: `  Less: CPP1 credit ${Fd(cpp.cpp1)} × ${P(BC_LOWEST_RATE)}`, value: `(${F(cppCrB)})` });
  s3.push({ label: "  Net BC tax", value: F(bNet), bold: true });
  s3.push({ label: "", spacer: true });
  s3.push({ label: "TOTAL PERSONAL TAX", value: F(pTax), bold: true, highlight: true });
  sections.push({ title: "3. Personal Income Tax — Taxpayer A", steps: s3 });

  // 4. AFNI → CCB
  const afniA = grossSal - cpp.cpp2;
  const sp = spouseTax(spouseInc);
  const spCPP = calcCPPDetail(spouseInc);
  const fAFNI = afniA + sp.afni;
  const ccb = calcCCBDetail(fAFNI, nU6, n617);
  const bcfb = calcBCFBDetail(fAFNI, totalKids);

  const s4 = [];
  s4.push({ label: "TAXPAYER A — AFNI", bold: true });
  s4.push({ label: `  Employment income (salary)`, value: F(grossSal) });
  if (cpp.cpp2 > 0) s4.push({ label: `  Less: CPP2 deduction (s. 60(e.1))`, value: `(${Fd(cpp.cpp2)})` });
  s4.push({ label: `  Taxpayer A AFNI`, value: F(afniA), bold: true });
  s4.push({ label: "", spacer: true });
  s4.push({ label: "SPOUSE — AFNI", bold: true });
  s4.push({ label: `  Employment income`, value: F(spouseInc) });
  if (spCPP.cpp2 > 0) s4.push({ label: `  Less: CPP2`, value: `(${Fd(spCPP.cpp2)})` });
  s4.push({ label: `  Spouse AFNI`, value: F(sp.afni), bold: true });
  s4.push({ label: "", spacer: true });
  s4.push({ label: "FAMILY AFNI (line 23600 + spouse line 23600)", value: F(fAFNI), bold: true, highlight: true });
  s4.push({ label: "", spacer: true });
  s4.push({ label: "CCB CALCULATION", bold: true });
  ccb.trace.forEach(t => s4.push({ label: `  ${t}` }));
  s4.push({ label: "", spacer: true });
  s4.push({ label: "BCFB CALCULATION", bold: true });
  bcfb.trace.forEach(t => s4.push({ label: `  ${t}` }));
  sections.push({ title: "4. Family AFNI → CCB / BCFB", steps: s4 });

  // 5. CASH SUMMARY
  const aAT = grossSal - pTax - cpp.total;
  const famAT = aAT + sp.afterTax + ccb.amount + bcfb.amount;
  const allTax = pTax + cpp.total + cpp.total + sp.tax + sp.cpp;
  const rrsp = Math.min(grossSal * RRSP_RATE, RRSP_MAX);

  sections.push({ title: "5. Family Cash Summary", steps: [
    { label: "Taxpayer A net cash", bold: true },
    { label: `  ${F(grossSal)} − ${F(pTax)} − ${Fd(cpp.total)}`, value: F(aAT) },
    { label: "Spouse net cash", value: F(sp.afterTax) },
    { label: "CCB received (tax-free)", value: F(ccb.amount) },
    { label: "BCFB received (tax-free)", value: F(bcfb.amount) },
    { label: "", spacer: true },
    { label: "FAMILY AFTER-TAX CASH", value: F(famAT), bold: true, highlight: true },
    { label: "", spacer: true },
    { label: "Total tax & CPP (all parties)", value: F(allTax), bold: true },
    { label: "RRSP room: min(18% × salary, $33,810)", value: F(rrsp) },
  ]});

  return {
    corpCost, corpTax: 0, personalTax: pTax, cppEe: cpp.total, cppEr: cpp.total,
    totalTax: allTax, ccb: ccb.amount, bcfb: bcfb.amount, totalBenefits: ccb.amount + bcfb.amount,
    afniA, spouseAFNI: sp.afni, phantomIncome: 0, spouseTaxCPP: sp.tax + sp.cpp,
    familyAFNI: fAFNI, familyAfterTax: famAT, aAfterTax: aAT,
    spouseAfterTax: sp.afterTax, rrspRoom: rrsp, trace: { sections },
  };
}

function dividendFull(corpInc, spouseInc, nU6, n617) {
  const totalKids = nU6 + n617;
  const sections = [];
  const minSal = 3500;

  // 1. CORPORATE
  const incForDiv = corpInc - minSal;
  const corpTax = Math.max(0, incForDiv * CORP_TAX_RATE);
  const divPaid = Math.max(0, incForDiv - corpTax);

  sections.push({ title: "1. Corporate Level — SBD Income to Dividend", steps: [
    { label: "Corporate active business income", value: F(corpInc) },
    { label: "Less: salary deduction (s. 9)", value: `(${F(minSal)})` },
    { label: "Taxable income subject to SBD", value: F(incForDiv), bold: true },
    { label: "", spacer: true },
    { label: `Corporate tax: ${F(incForDiv)} × ${P(CORP_TAX_RATE)}`, value: F(corpTax), bold: true },
    { label: `  Federal: ${F(incForDiv)} × 9% = ${F(incForDiv * 0.09)}`, note: true },
    { label: `  BC:      ${F(incForDiv)} × 2% = ${F(incForDiv * 0.02)}`, note: true },
    { label: "", spacer: true },
    { label: "After-tax funds → non-eligible dividend", value: F(divPaid), bold: true, highlight: true },
    { label: `  ${F(incForDiv)} × (1 − ${P(CORP_TAX_RATE)}) = ${F(incForDiv)} × 89% = ${F(divPaid)}`, note: true },
  ]});

  // 2. DIVIDEND GROSS-UP & PERSONAL TAX
  const grossedUp = divPaid * (1 + GROSS_UP);
  const taxInc = minSal + grossedUp;
  const fB = bracketDetail(taxInc, FED_BRACKETS);
  const bB = bracketDetail(taxInc, BC_BRACKETS);
  const fBPA = Math.min(fB.total, FED_BPA * FED_LOWEST_RATE);
  const bBPA = Math.min(bB.total, BC_BPA * BC_LOWEST_RATE);
  const fDTC = grossedUp * FED_DTC;
  const bDTC = grossedUp * BC_DTC;
  const fNet = Math.max(0, fB.total - fBPA - fDTC);
  const bNet = Math.max(0, bB.total - bBPA - bDTC);
  const pTax = fNet + bNet;

  const s2 = [];
  s2.push({ label: "DIVIDEND GROSS-UP MECHANISM", bold: true });
  s2.push({ label: `  Actual cash dividend received`, value: F(divPaid) });
  s2.push({ label: `  × (1 + 15% gross-up)`, value: `× 1.15` });
  s2.push({ label: `  = Taxable dividend (line 12010)`, value: F(grossedUp), bold: true });
  s2.push({ label: `  The 15% gross-up is intended to approximate the`, note: true });
  s2.push({ label: `  pre-tax corporate profit: ${F(divPaid)} / 89% ≈ ${F(divPaid / 0.89)}`, note: true });
  s2.push({ label: "", spacer: true });
  s2.push({ label: "TOTAL TAXABLE INCOME", bold: true });
  s2.push({ label: `  Salary (line 10100)`, value: F(minSal) });
  s2.push({ label: `  + Taxable dividends (line 12000)`, value: F(grossedUp) });
  s2.push({ label: `  = Total taxable income`, value: F(taxInc), bold: true });
  s2.push({ label: "", spacer: true });

  s2.push({ label: "FEDERAL TAX", bold: true });
  fB.rows.forEach(r => s2.push({ label: `  ${F(r.amount)} × ${P(r.rate)}`, value: F(r.tax) }));
  s2.push({ label: "  Gross federal tax", value: F(fB.total), bold: true });
  s2.push({ label: `  Less: BPA credit ${F(FED_BPA)} × ${P(FED_LOWEST_RATE)}`, value: `(${F(fBPA)})` });
  s2.push({ label: `  Less: Fed DTC ${F(grossedUp)} × ${P(FED_DTC)}`, value: `(${F(fDTC)})` });
  s2.push({ label: `    → s. 121 credit intended to offset tax already paid at corp level`, note: true });
  s2.push({ label: "  Net federal tax", value: F(fNet), bold: true });
  s2.push({ label: "", spacer: true });

  s2.push({ label: "BC TAX", bold: true });
  bB.rows.forEach(r => s2.push({ label: `  ${F(r.amount)} × ${P(r.rate)}`, value: F(r.tax) }));
  s2.push({ label: "  Gross BC tax", value: F(bB.total), bold: true });
  s2.push({ label: `  Less: BPA credit ${F(BC_BPA)} × ${P(BC_LOWEST_RATE)}`, value: `(${F(bBPA)})` });
  s2.push({ label: `  Less: BC DTC ${F(grossedUp)} × ${P(BC_DTC)}`, value: `(${F(bDTC)})` });
  s2.push({ label: "  Net BC tax", value: F(bNet), bold: true });
  s2.push({ label: "", spacer: true });
  s2.push({ label: "TOTAL PERSONAL TAX", value: F(pTax), bold: true, highlight: true });
  s2.push({ label: "", spacer: true });
  s2.push({ label: "INTEGRATION CHECK", bold: true });
  const totalInteg = corpTax + pTax;
  const asIfSalary = bracketDetail(taxInc, FED_BRACKETS).total + bracketDetail(taxInc, BC_BRACKETS).total
    - Math.min(bracketDetail(taxInc, FED_BRACKETS).total, FED_BPA * FED_LOWEST_RATE)
    - Math.min(bracketDetail(taxInc, BC_BRACKETS).total, BC_BPA * BC_LOWEST_RATE);
  s2.push({ label: `  Corp tax + personal tax on dividend`, value: F(totalInteg) });
  s2.push({ label: `  Tax if same income earned as salary`, value: `≈ ${F(asIfSalary)}` });
  const gap = totalInteg - asIfSalary;
  s2.push({ label: `  Integration gap (over)/under`, value: F(gap), note: true });
  sections.push({ title: "2. Dividend Gross-Up, DTC & Personal Tax", steps: s2 });

  // 3. AFNI — THE CRITICAL LINK
  const afniA = minSal + grossedUp;
  const sp = spouseTax(spouseInc);
  const spCPP = calcCPPDetail(spouseInc);
  const fAFNI = afniA + sp.afni;
  const ccb = calcCCBDetail(fAFNI, nU6, n617);
  const bcfb = calcBCFBDetail(fAFNI, totalKids);
  const phantomInc = grossedUp - divPaid;

  const s3 = [];
  s3.push({ label: "TAXPAYER A — NET INCOME (LINE 23600)", bold: true });
  s3.push({ label: `  Salary`, value: F(minSal) });
  s3.push({ label: `  + Taxable (grossed-up) dividend`, value: F(grossedUp) });
  s3.push({ label: `  = Taxpayer A AFNI`, value: F(afniA), bold: true });
  s3.push({ label: "", spacer: true });
  s3.push({ label: "⚠ AFNI INFLATION FROM GROSS-UP", bold: true });
  s3.push({ label: `  Cash actually received: ${F(minSal)} + ${F(divPaid)} = ${F(minSal + divPaid)}` });
  s3.push({ label: `  AFNI reported: ${F(afniA)}` });
  s3.push({ label: `  Phantom income (15% gross-up): ${F(phantomInc)}`, highlight: true });
  s3.push({ label: `  This phantom ${F(phantomInc)} drives higher CCB clawback`, note: true });
  s3.push({ label: "", spacer: true });
  s3.push({ label: "SPOUSE AFNI", bold: true });
  s3.push({ label: `  Employment income`, value: F(spouseInc) });
  if (spCPP.cpp2 > 0) s3.push({ label: `  Less: CPP2`, value: `(${Fd(spCPP.cpp2)})` });
  s3.push({ label: `  Spouse AFNI`, value: F(sp.afni), bold: true });
  s3.push({ label: "", spacer: true });
  s3.push({ label: "FAMILY AFNI", value: F(fAFNI), bold: true, highlight: true });
  s3.push({ label: "", spacer: true });
  s3.push({ label: "CCB CALCULATION", bold: true });
  ccb.trace.forEach(t => s3.push({ label: `  ${t}` }));
  s3.push({ label: "", spacer: true });
  s3.push({ label: "BCFB CALCULATION", bold: true });
  bcfb.trace.forEach(t => s3.push({ label: `  ${t}` }));
  sections.push({ title: "3. AFNI — Why Dividends Cost More CCB", steps: s3 });

  // 4. CASH SUMMARY
  const aAT = minSal + divPaid - pTax;
  const famAT = aAT + sp.afterTax + ccb.amount + bcfb.amount;
  const allTax = corpTax + pTax + sp.tax + sp.cpp;

  sections.push({ title: "4. Family Cash Summary", steps: [
    { label: "Taxpayer A net cash", bold: true },
    { label: `  ${F(minSal)} + ${F(divPaid)} − ${F(pTax)}`, value: F(aAT) },
    { label: "Spouse net cash", value: F(sp.afterTax) },
    { label: "CCB received (tax-free)", value: F(ccb.amount) },
    { label: "BCFB received (tax-free)", value: F(bcfb.amount) },
    { label: "", spacer: true },
    { label: "FAMILY AFTER-TAX CASH", value: F(famAT), bold: true, highlight: true },
    { label: "", spacer: true },
    { label: "Total tax (corp + personal + spouse)", value: F(allTax), bold: true },
    { label: "RRSP room: 18% × $3,500 salary only", value: F(minSal * RRSP_RATE) },
  ]});

  return {
    corpCost: corpInc, corpTax, personalTax: pTax, cppEe: 0, cppEr: 0,
    dividendPaid: divPaid, grossedUpDiv: grossedUp,
    totalTax: allTax, ccb: ccb.amount, bcfb: bcfb.amount, totalBenefits: ccb.amount + bcfb.amount,
    afniA, spouseAFNI: sp.afni, phantomIncome: phantomInc, spouseTaxCPP: sp.tax + sp.cpp,
    familyAFNI: fAFNI, familyAfterTax: famAT, aAfterTax: aAT,
    spouseAfterTax: sp.afterTax, rrspRoom: minSal * RRSP_RATE,
    trace: { sections },
  };
}

function solve(target, spouseInc, nU6, n617, strat) {
  let lo = 0, hi = 2000000;
  const calc = v => strat === "salary" ? salaryFull(v, spouseInc, nU6, n617) : dividendFull(v, spouseInc, nU6, n617);
  if (calc(hi).familyAfterTax < target) return null;
  for (let i = 0; i < 35; i++) {
    const mid = (lo + hi) / 2;
    if (calc(mid).familyAfterTax < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function findBE(spouseInc, nU6, n617) {
  let lo = 30000, hi = 400000;
  const diffAt = c => salaryFull(c, spouseInc, nU6, n617).familyAfterTax
                    - dividendFull(c, spouseInc, nU6, n617).familyAfterTax;
  const diffLo = diffAt(lo);
  const diffHi = diffAt(hi);
  if (diffLo === 0) return lo;
  if (diffHi === 0) return hi;
  // No sign change in range — no crossing
  if (Math.sign(diffLo) === Math.sign(diffHi)) return null;
  for (let i = 0; i < 35; i++) {
    const mid = (lo + hi) / 2;
    const diffMid = diffAt(mid);
    if (diffMid === 0) return mid;
    if (Math.sign(diffMid) === Math.sign(diffLo)) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// ═══════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════
export default function App() {
  const [target, setTarget] = useState(100000);
  const [spouseInc, setSpouseInc] = useState(20000);
  const [nU6, setNU6] = useState(2);
  const [n617, setN617] = useState(0);
  const [abCorp, setAbCorp] = useState(150000);

  const [mode, setMode] = useState("target");
  const [openSec, setOpenSec] = useState({});
  const tog = k => setOpenSec(p => ({ ...p, [k]: !p[k] }));

  const tRes = useMemo(() => {
    const sN = solve(target, spouseInc, nU6, n617, "salary");
    const dN = solve(target, spouseInc, nU6, n617, "dividend");
    return {
      sN,
      dN,
      sal: sN !== null ? salaryFull(sN, spouseInc, nU6, n617) : null,
      div: dN !== null ? dividendFull(dN, spouseInc, nU6, n617) : null,
    };
  }, [target, spouseInc, nU6, n617]);

  const abRes = useMemo(() => ({
    sal: salaryFull(abCorp, spouseInc, nU6, n617),
    div: dividendFull(abCorp, spouseInc, nU6, n617),
  }), [abCorp, spouseInc, nU6, n617]);

  const be = useMemo(() => findBE(spouseInc, nU6, n617), [spouseInc, nU6, n617]);

  const rng = useMemo(() => {
    const p = [];
    for (let c = 40000; c <= 500000; c += 10000) {
      const s = salaryFull(c, spouseInc, nU6, n617);
      const d = dividendFull(c, spouseInc, nU6, n617);
      p.push({ c, sAT: s.familyAfterTax, dAT: d.familyAfterTax, sTx: s.totalTax, dTx: d.totalTax, deltaAT: s.familyAfterTax - d.familyAfterTax });
    }
    return p;
  }, [spouseInc, nU6, n617]);

  const { sal, div } = mode === "target" ? tRes : abRes;

  const recIsSalary = (() => {
    if (tRes.sN === null && tRes.dN === null) return null;
    if (tRes.sN === null) return false;
    if (tRes.dN === null) return true;
    return mode === "target" ? tRes.sN < tRes.dN : (sal && div ? sal.familyAfterTax > div.familyAfterTax : null);
  })();
  const recX = recIsSalary === true ? tRes.sN : recIsSalary === false ? tRes.dN : null;
  const interpAt = (x, k) => {
    if (x == null) return null;
    for (let i = 0; i < rng.length - 1; i++) {
      if (rng[i].c <= x && x <= rng[i + 1].c) {
        const t = (x - rng[i].c) / (rng[i + 1].c - rng[i].c);
        return rng[i][k] + t * (rng[i + 1][k] - rng[i][k]);
      }
    }
    return null;
  };

  const V = {
    bg: "#0c0e14", card: "#151820", card2: "#1a1e2a", border: "#262b3a",
    fg: "#e4e7ef", muted: "#6d7590", accent: "#5b9cf5", accent2: "#3dd9a0",
    warn: "#f5a543", be: "#e879a8", grid: "#1e2230",
    mono: "'JetBrains Mono','SF Mono','Fira Code',Consolas,monospace",
    sans: "'DM Sans','Inter',system-ui,sans-serif",
  };

  const Sec = ({ section, sKey, idx }) => {
    const k = `${sKey}-${idx}`;
    const open = openSec[k] === true;
    return (
      <div style={{ marginBottom: 1 }}>
        <button onClick={() => tog(k)} style={{ width: "100%", textAlign: "left", padding: "8px 12px", background: V.card2, border: "none", borderBottom: `1px solid ${V.border}`, color: V.fg, cursor: "pointer", fontFamily: V.mono, fontSize: 11.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: V.muted, fontSize: 9, transition: "transform 0.15s", transform: open ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block" }}>▶</span>
          {section.title}
        </button>
        {open && <div style={{ padding: "6px 12px 10px" }}>
          {section.steps.map((st, j) => {
            if (st.spacer) return <div key={j} style={{ height: 6 }} />;
            const hlBg = st.highlight ? V.card2 : "transparent";
            const hlPad = st.highlight ? "5px 10px" : "2px 0";
            const hlMrg = st.highlight ? "3px -10px" : 0;
            return (
              <div key={j} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", background: hlBg, padding: hlPad, margin: hlMrg, borderRadius: st.highlight ? 4 : 0 }}>
                <span style={{ fontSize: st.note ? 10 : 11, fontFamily: V.mono, color: st.note ? V.muted : st.bold ? V.fg : V.muted, fontWeight: st.bold ? 600 : 400, fontStyle: st.note ? "italic" : "normal", whiteSpace: "pre-wrap", flex: "1 1 auto", minWidth: 0 }}>
                  {st.label}
                </span>
                {st.value && <span style={{ fontSize: 11.5, fontFamily: V.mono, fontWeight: st.bold ? 700 : 500, color: st.highlight ? (sKey === "sal" ? V.accent : V.accent2) : V.fg, marginLeft: 12, whiteSpace: "nowrap", flexShrink: 0 }}>
                  {st.value}
                </span>}
              </div>
            );
          })}
        </div>}
      </div>
    );
  };

  const cW = 860, cH = 300, cP = { t: 32, r: 20, b: 46, l: 64 };
  const iW = cW - cP.l - cP.r, iH = cH - cP.t - cP.b;
  const Chrt = ({ data, k1, k2, l1, l2, c1, c2, lowerIsBetter, targetLine, dot }) => {
    const [hoverIdx, setHoverIdx] = useState(null);

    const aY = data.flatMap(d => [d[k1], d[k2]]);
    const yMn = Math.min(...aY), yMx = Math.max(...aY), yR = yMx - yMn || 1;
    const xMn = data[0].c, xMx = data[data.length - 1].c, xR = xMx - xMn || 1;
    const tX = v => cP.l + ((v - xMn) / xR) * iW;
    const tY = v => cP.t + iH - ((v - yMn) / yR) * iH;

    // Build filled area segments between the two curves with crossover interpolation
    const fills = [];
    for (let i = 0; i < data.length - 1; i++) {
      const d0 = data[i], d1 = data[i + 1];
      const diff0 = d0[k1] - d0[k2], diff1 = d1[k1] - d1[k2];
      const salBetter = v => lowerIsBetter ? v < 0 : v > 0;
      const addFill = (ax, ay1, ay2, bx, by1, by2) =>
        fills.push({ salaryBetter: salBetter(ay1 - ay2), path: `M${tX(ax)},${tY(ay1)} L${tX(bx)},${tY(by1)} L${tX(bx)},${tY(by2)} L${tX(ax)},${tY(ay2)} Z` });
      if (Math.sign(diff0) === Math.sign(diff1) || diff0 === 0 || diff1 === 0) {
        addFill(d0.c, d0[k1], d0[k2], d1.c, d1[k1], d1[k2]);
      } else {
        const t = diff0 / (diff0 - diff1);
        const crossC = d0.c + t * (d1.c - d0.c);
        const crossV = d0[k1] + t * (d1[k1] - d0[k1]);
        addFill(d0.c, d0[k1], d0[k2], crossC, crossV, crossV);
        addFill(crossC, crossV, crossV, d1.c, d1[k1], d1[k2]);
      }
    }

    const p1 = data.map((d, i) => `${i ? "L" : "M"}${tX(d.c)},${tY(d[k1])}`).join("");
    const p2 = data.map((d, i) => `${i ? "L" : "M"}${tX(d.c)},${tY(d[k2])}`).join("");
    const yS = Math.ceil(yR / 4 / 10000) * 10000;
    const yT = [];
    for (let v = Math.floor(yMn / yS) * yS; v <= yMx + yS; v += yS) if (v >= yMn - yS * 0.5 && v <= yMx + yS * 0.5) yT.push(v);
    const xTicks = data.filter(d => d.c % 50000 === 0);

    const handleMouseMove = e => {
      const rect = e.currentTarget.getBoundingClientRect();
      const mouseXVB = ((e.clientX - rect.left) / rect.width) * cW;
      const raw = Math.round(((mouseXVB - cP.l) / iW) * (data.length - 1));
      setHoverIdx(Math.max(0, Math.min(data.length - 1, raw)));
    };

    const hd = hoverIdx !== null ? data[hoverIdx] : null;
    const ttW = 188, ttH = 76;
    const ttX = hd ? (tX(hd.c) + 14 + ttW > cW - 8 ? tX(hd.c) - 14 - ttW : tX(hd.c) + 14) : 0;
    const ttY = hd ? Math.max(cP.t + 4, Math.min(cP.t + iH - ttH - 4, tY((hd[k1] + hd[k2]) / 2) - ttH / 2)) : 0;

    return (
      <svg viewBox={`0 0 ${cW} ${cH}`} style={{ width: "100%", display: "block", cursor: "crosshair" }}
        onMouseMove={handleMouseMove} onMouseLeave={() => setHoverIdx(null)}>
        {/* Mouse capture area */}
        <rect x={cP.l} y={cP.t} width={iW} height={iH} fill="transparent" />
        {/* Filled regions between curves */}
        {fills.map((f, i) => <path key={i} d={f.path} fill={f.salaryBetter ? c1 : c2} fillOpacity={0.13} stroke="none" />)}
        {/* Y-axis grid + labels */}
        {yT.map(v => <g key={v}><line x1={cP.l} y1={tY(v)} x2={cP.l + iW} y2={tY(v)} stroke={V.grid} strokeWidth="0.5" /><text x={cP.l - 6} y={tY(v) + 3.5} fill={V.muted} fontSize="10" textAnchor="end" fontFamily={V.mono}>{Math.round(v / 1000)}k</text></g>)}
        {/* X-axis ticks + labels */}
        {xTicks.map(d => <g key={d.c}><line x1={tX(d.c)} y1={cP.t + iH} x2={tX(d.c)} y2={cP.t + iH + 4} stroke={V.border} strokeWidth="1" /><text x={tX(d.c)} y={cP.t + iH + 16} fill={V.muted} fontSize="9.5" textAnchor="middle" fontFamily={V.mono}>{d.c / 1000}k</text></g>)}
        {/* Break-even */}
        {be !== null && be >= xMn && be <= xMx && <><line x1={tX(be)} y1={cP.t} x2={tX(be)} y2={cP.t + iH} stroke={V.be} strokeWidth="1.5" strokeDasharray="5,3" /><text x={tX(be)} y={cP.t - 8} fill={V.be} fontSize="9.5" textAnchor="middle" fontFamily={V.mono}>B/E {F(be)}</text></>}
        {/* Target line */}
        {targetLine != null && targetLine >= yMn && targetLine <= yMx && (() => {
          const ty = tY(targetLine);
          return (
            <g>
              <line x1={cP.l} y1={ty} x2={cP.l + iW} y2={ty} stroke={V.warn} strokeWidth="1" strokeDasharray="5,3" strokeOpacity="0.8" />
              <text x={cP.l + 6} y={ty - 4} fill={V.warn} fontSize="9" fontFamily={V.mono}>Target {F(targetLine)}</text>
            </g>
          );
        })()}
        {/* Lines */}
        <path d={p1} fill="none" stroke={c1} strokeWidth="2.5" />
        <path d={p2} fill="none" stroke={c2} strokeWidth="2.5" />
        {/* Recommended dot */}
        {dot && dot.x >= xMn && dot.x <= xMx && dot.y != null && (() => {
          const cx = tX(dot.x), cy = tY(dot.y);
          const labelY = cy - cP.t < 20 ? cy + 16 : cy - 7;
          return (
            <g>
              <circle cx={cx} cy={cy} r="4.5" fill="white" stroke={V.card} strokeWidth="1" />
              <text x={cx} y={labelY} fill="white" fontSize="9" fontFamily={V.mono} textAnchor="middle">{F(dot.x)}</text>
            </g>
          );
        })()}
        {/* Legend */}
        <rect x={cP.l + 8} y={cP.t + 4} width="12" height="3" rx="1.5" fill={c1} /><text x={cP.l + 24} y={cP.t + 11} fill={V.fg} fontSize="10" fontFamily={V.mono}>{l1}</text>
        <rect x={cP.l + 8} y={cP.t + 18} width="12" height="3" rx="1.5" fill={c2} /><text x={cP.l + 24} y={cP.t + 25} fill={V.fg} fontSize="10" fontFamily={V.mono}>{l2}</text>
        {/* X-axis label */}
        <text x={cW / 2} y={cH - 4} fill={V.muted} fontSize="9.5" textAnchor="middle" fontFamily={V.mono}>Corp Cost / Gross Salary</text>
        {/* Hover overlay */}
        {hd && (() => {
          const diff = hd[k1] - hd[k2];
          const salBetter = lowerIsBetter ? diff < 0 : diff > 0;
          return (
            <g>
              <line x1={tX(hd.c)} y1={cP.t} x2={tX(hd.c)} y2={cP.t + iH} stroke={V.fg} strokeWidth="0.5" strokeOpacity="0.35" strokeDasharray="3,3" />
              <circle cx={tX(hd.c)} cy={tY(hd[k1])} r="4" fill={c1} stroke={V.bg} strokeWidth="1.5" />
              <circle cx={tX(hd.c)} cy={tY(hd[k2])} r="4" fill={c2} stroke={V.bg} strokeWidth="1.5" />
              <rect x={ttX} y={ttY} width={ttW} height={ttH} rx="5" fill={V.card2} stroke={V.border} strokeWidth="0.75" />
              <text x={ttX + 10} y={ttY + 13} fill={V.muted} fontSize="9" fontFamily={V.mono}>CORP COST</text>
              <text x={ttX + ttW - 10} y={ttY + 13} fill={V.fg} fontSize="10" fontFamily={V.mono} fontWeight="600" textAnchor="end">{F(hd.c)}</text>
              <line x1={ttX + 1} y1={ttY + 19} x2={ttX + ttW - 1} y2={ttY + 19} stroke={V.border} strokeWidth="0.5" />
              <text x={ttX + 10} y={ttY + 33} fill={c1} fontSize="9.5" fontFamily={V.mono}>{l1}</text>
              <text x={ttX + ttW - 10} y={ttY + 33} fill={V.fg} fontSize="9.5" fontFamily={V.mono} textAnchor="end">{F(hd[k1])}</text>
              <text x={ttX + 10} y={ttY + 47} fill={c2} fontSize="9.5" fontFamily={V.mono}>{l2}</text>
              <text x={ttX + ttW - 10} y={ttY + 47} fill={V.fg} fontSize="9.5" fontFamily={V.mono} textAnchor="end">{F(hd[k2])}</text>
              <line x1={ttX + 1} y1={ttY + 53} x2={ttX + ttW - 1} y2={ttY + 53} stroke={V.border} strokeWidth="0.5" />
              <text x={ttX + 10} y={ttY + 67} fill={V.muted} fontSize="9.5" fontFamily={V.mono}>{"Δ " + (salBetter ? l1 : l2) + " better"}</text>
              <text x={ttX + ttW - 10} y={ttY + 67} fill={V.warn} fontSize="9.5" fontFamily={V.mono} textAnchor="end">{F(Math.abs(diff))}</text>
            </g>
          );
        })()}
      </svg>
    );
  };

  const DeltaChrt = ({ data, dot }) => {
    const [hoverIdx, setHoverIdx] = useState(null);

    const vals = data.map(d => d.deltaAT);
    const yMx = Math.max(...vals.map(Math.abs), 1);
    // Symmetric y-axis centred on zero
    const yMn = -yMx, yR = yMx * 2;
    const xMn = data[0].c, xMx = data[data.length - 1].c, xR = xMx - xMn || 1;
    const tX = v => cP.l + ((v - xMn) / xR) * iW;
    const tY = v => cP.t + iH - ((v - yMn) / yR) * iH;
    const zeroY = tY(0);

    // Path
    const path = data.map((d, i) => `${i ? "L" : "M"}${tX(d.c)},${tY(d.deltaAT)}`).join("");

    // Filled area: above zero (salary better) and below zero (dividend better)
    const abovePath = data.map((d, i) => `${i ? "L" : "M"}${tX(d.c)},${tY(Math.max(d.deltaAT, 0))}`).join("")
      + ` L${tX(xMx)},${zeroY} L${tX(xMn)},${zeroY} Z`;
    const belowPath = data.map((d, i) => `${i ? "L" : "M"}${tX(d.c)},${tY(Math.min(d.deltaAT, 0))}`).join("")
      + ` L${tX(xMx)},${zeroY} L${tX(xMn)},${zeroY} Z`;

    const yS = Math.ceil(yMx / 2 / 10000) * 10000 || 10000;
    const yTicks = [];
    for (let v = -yMx; v <= yMx + yS * 0.5; v += yS) if (Math.abs(v) <= yMx * 1.05) yTicks.push(v);
    const xTicks = data.filter(d => d.c % 50000 === 0);

    const handleMouseMove = e => {
      const rect = e.currentTarget.getBoundingClientRect();
      const mouseXVB = ((e.clientX - rect.left) / rect.width) * cW;
      const raw = Math.round(((mouseXVB - cP.l) / iW) * (data.length - 1));
      setHoverIdx(Math.max(0, Math.min(data.length - 1, raw)));
    };

    const hd = hoverIdx !== null ? data[hoverIdx] : null;
    const ttW = 188, ttH = 58;
    const ttX = hd ? (tX(hd.c) + 14 + ttW > cW - 8 ? tX(hd.c) - 14 - ttW : tX(hd.c) + 14) : 0;
    const ttY = hd ? Math.max(cP.t + 4, Math.min(cP.t + iH - ttH - 4, tY(hd.deltaAT) - ttH / 2)) : 0;

    return (
      <svg viewBox={`0 0 ${cW} ${cH}`} style={{ width: "100%", display: "block", cursor: "crosshair" }}
        onMouseMove={handleMouseMove} onMouseLeave={() => setHoverIdx(null)}>
        {/* Mouse capture area */}
        <rect x={cP.l} y={cP.t} width={iW} height={iH} fill="transparent" />
        {/* Filled regions */}
        <path d={abovePath} fill={V.accent} fillOpacity={0.15} stroke="none" />
        <path d={belowPath} fill={V.accent2} fillOpacity={0.15} stroke="none" />
        {/* Grid lines */}
        {yTicks.map(v => <g key={v}><line x1={cP.l} y1={tY(v)} x2={cP.l + iW} y2={tY(v)} stroke={v === 0 ? V.muted : V.grid} strokeWidth={v === 0 ? 1 : 0.5} /><text x={cP.l - 6} y={tY(v) + 3.5} fill={V.muted} fontSize="10" textAnchor="end" fontFamily={V.mono}>{v === 0 ? "0" : `${Math.round(v / 1000)}k`}</text></g>)}
        {/* X-axis ticks */}
        {xTicks.map(d => <g key={d.c}><line x1={tX(d.c)} y1={cP.t + iH} x2={tX(d.c)} y2={cP.t + iH + 4} stroke={V.border} strokeWidth="1" /><text x={tX(d.c)} y={cP.t + iH + 16} fill={V.muted} fontSize="9.5" textAnchor="middle" fontFamily={V.mono}>{d.c / 1000}k</text></g>)}
        {/* Break-even */}
        {be !== null && be >= xMn && be <= xMx && <><line x1={tX(be)} y1={cP.t} x2={tX(be)} y2={cP.t + iH} stroke={V.be} strokeWidth="1.5" strokeDasharray="5,3" /><text x={tX(be)} y={cP.t - 8} fill={V.be} fontSize="9.5" textAnchor="middle" fontFamily={V.mono}>B/E {F(be)}</text></>}
        {/* Delta line */}
        <path d={path} fill="none" stroke={V.warn} strokeWidth="2.5" />
        {/* Recommended dot */}
        {dot && dot.x >= xMn && dot.x <= xMx && dot.y != null && (() => {
          const cx = tX(dot.x), cy = tY(dot.y);
          const labelY = cy - cP.t < 20 ? cy + 16 : cy - 7;
          return (
            <g>
              <circle cx={cx} cy={cy} r="4.5" fill="white" stroke={V.card} strokeWidth="1" />
              <text x={cx} y={labelY} fill="white" fontSize="9" fontFamily={V.mono} textAnchor="middle">{F(dot.x)}</text>
            </g>
          );
        })()}
        {/* Region labels */}
        <text x={cP.l + 8} y={zeroY - 6} fill={V.accent} fontSize="9.5" fontFamily={V.mono} fontWeight="600">▲ Salary advantage</text>
        <text x={cP.l + 8} y={zeroY + 14} fill={V.accent2} fontSize="9.5" fontFamily={V.mono} fontWeight="600">▼ Dividend advantage</text>
        {/* X-axis label */}
        <text x={cW / 2} y={cH - 4} fill={V.muted} fontSize="9.5" textAnchor="middle" fontFamily={V.mono}>Corp Cost / Gross Salary</text>
        {/* Hover overlay */}
        {hd && (() => {
          const salBetter = hd.deltaAT > 0;
          const deltaStr = (salBetter ? "+" : "−") + F(Math.abs(hd.deltaAT));
          return (
            <g>
              <line x1={tX(hd.c)} y1={cP.t} x2={tX(hd.c)} y2={cP.t + iH} stroke={V.fg} strokeWidth="0.5" strokeOpacity="0.35" strokeDasharray="3,3" />
              <circle cx={tX(hd.c)} cy={tY(hd.deltaAT)} r="4" fill={V.warn} stroke={V.bg} strokeWidth="1.5" />
              <rect x={ttX} y={ttY} width={ttW} height={ttH} rx="5" fill={V.card2} stroke={V.border} strokeWidth="0.75" />
              <text x={ttX + 10} y={ttY + 13} fill={V.muted} fontSize="9" fontFamily={V.mono}>CORP COST</text>
              <text x={ttX + ttW - 10} y={ttY + 13} fill={V.fg} fontSize="10" fontFamily={V.mono} fontWeight="600" textAnchor="end">{F(hd.c)}</text>
              <line x1={ttX + 1} y1={ttY + 19} x2={ttX + ttW - 1} y2={ttY + 19} stroke={V.border} strokeWidth="0.5" />
              <text x={ttX + 10} y={ttY + 33} fill={V.muted} fontSize="9.5" fontFamily={V.mono}>Sal − Div</text>
              <text x={ttX + ttW - 10} y={ttY + 33} fill={salBetter ? V.accent : V.accent2} fontSize="9.5" fontFamily={V.mono} textAnchor="end">{deltaStr}</text>
              <text x={ttX + ttW / 2} y={ttY + 49} fill={salBetter ? V.accent : V.accent2} fontSize="9" fontFamily={V.mono} fontWeight="600" textAnchor="middle">{salBetter ? "▲ Salary advantage" : "▼ Dividend advantage"}</text>
            </g>
          );
        })()}
      </svg>
    );
  };

  const R1K = v => v !== null && v !== undefined ? Math.round(v / 1000) * 1000 : null;
  const rows = [
    // ── Declaration info ───────────────────────────────────
    { l: "Declare (rounded to nearest $1k)", tip: "Gross salary before employer CPP, or non-eligible dividend — rounded to the nearest $1,000 for practical filing.", s: sal ? R1K(sal.corpCost - sal.cppEr) : null, d: div ? R1K(div.dividendPaid) : null, info: true },
    // ── Corporate ──────────────────────────────────────────
    { hdr: "Corporate" },
    { l: "Corporate Cost", tip: "Total cash leaving the corporation — gross salary + employer CPP for salary; gross dividend for dividends.", s: sal?.corpCost, d: div?.corpCost },
    { l: "Corporate Tax (SBD 11%)", tip: "Small Business Deduction: 9% federal + 2% BC = 11% on active business income. Salary is fully deductible — zero corporate tax.", s: sal?.corpTax, d: div?.corpTax, lo: true },
    // ── Personal tax & CPP ─────────────────────────────────
    { hdr: "Personal Tax & CPP" },
    { l: "Personal Income Tax", s: sal?.personalTax, d: div?.personalTax, lo: true },
    { l: "CPP (EE + ER)", tip: "Canada Pension Plan — Employee (EE) and matching Employer (ER) portions paid on salary. Dividends are exempt from CPP.", s: sal ? sal.cppEe + sal.cppEr : null, d: div ? 0 : null, lo: true },
    { l: "Spouse Tax & CPP", tip: "Spouse's personal income tax and CPP — identical under both strategies since spouse income is unchanged.", s: sal?.spouseTaxCPP, d: div?.spouseTaxCPP },
    null,
    { l: "Total Tax & CPP", tip: "Sum of all taxes and CPP contributions across corporate, personal, and spouse — the total leakage from gross income.", s: sal?.totalTax, d: div?.totalTax, hl: true, lo: true },
    // ── AFNI & benefits ────────────────────────────────────
    { hdr: "AFNI & Child Benefits" },
    { l: "Taxpayer A AFNI", tip: "Salary: gross salary less CPP2 deduction. Dividend: $3,500 salary + grossed-up dividend (cash + 15% gross-up) — this is higher than cash actually received.", s: sal?.afniA, d: div?.afniA, lo: true },
    { l: "  Dividend Gross-Up", tip: "The 15% gross-up required by the ITA inflates dividend AFNI above cash received — drives higher CCB/BCFB clawback with no corresponding cash.", s: sal?.phantomIncome, d: div?.phantomIncome, lo: true, indent: true },
    { l: "Spouse AFNI", tip: "Spouse's Adjusted Net Income — identical under both strategies since spouse income is unchanged.", s: sal?.spouseAFNI, d: div?.spouseAFNI },
    { l: "Family AFNI", tip: "Combined AFNI of both spouses — the figure used to calculate CCB and BCFB. Higher under dividend due to the gross-up.", s: sal?.familyAFNI, d: div?.familyAFNI, hl: true, lo: true },
    { l: "CCB", tip: "Canada Child Benefit — tax-free. Phases out above $37,487 family AFNI. Salary yields higher CCB when dividend AFNI is inflated by the gross-up.", s: sal?.ccb, d: div?.ccb, hi: true },
    { l: "BCFB", tip: "BC Family Benefit — provincial supplement, also income-tested. Same directional impact as CCB.", s: sal?.bcfb, d: div?.bcfb, hi: true },
    { l: "Total Benefits (CCB + BCFB)", s: sal?.totalBenefits, d: div?.totalBenefits, hl: true, hi: true },
    // ── Outcome ────────────────────────────────────────────
    { hdr: "Outcome" },
    { l: "Taxpayer A Net Cash", tip: "Gross salary less personal tax and CPP (salary), or salary + dividend less personal tax (dividend).", s: sal?.aAfterTax, d: div?.aAfterTax },
    { l: "Spouse Net Cash", s: sal?.spouseAfterTax, d: div?.spouseAfterTax },
    { l: "CCB (tax-free)", s: sal?.ccb, d: div?.ccb },
    { l: "BCFB (tax-free)", s: sal?.bcfb, d: div?.bcfb },
    null,
    { l: "Family After-Tax Cash", tip: "Taxpayer A net cash + spouse net cash + CCB + BCFB.", s: sal?.familyAfterTax, d: div?.familyAfterTax, hl: true, hi: true },
    { l: "RRSP Room", tip: "18% of earned income (salary only), max $33,810. Dividends generate no RRSP room — a compounding disadvantage.", s: sal?.rrspRoom, d: div?.rrspRoom, hi: true },
  ];

  return (
    <div style={{ background: V.bg, color: V.fg, fontFamily: V.sans, minHeight: "100vh", padding: "20px 14px", boxSizing: "border-box" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, fontFamily: V.mono, color: V.muted, textTransform: "uppercase", letterSpacing: "0.12em" }}>Steven Alexander CPA Inc.</div>
          <h1 style={{ fontSize: 19, fontWeight: 700, margin: "3px 0 0", letterSpacing: "0.04em" }}>Salary vs. Dividend — Detailed Workpaper</h1>
          <div style={{ fontSize: 11, fontFamily: V.mono, color: V.muted, marginTop: 2 }}>BC · CCPC SBD · 2026 · Non-eligible dividends · EI exempt</div>
        </div>

        
        
        <div style={{ display: "flex", flexWrap: "nowrap", gap: 10, background: V.card, borderRadius: 8, padding: 12, border: `1px solid ${V.border}`, marginBottom: 14, overflowX: "auto" }}>
          {/* Target After-Tax */}
          <div style={{ flex: "0 0 auto" }}>
            <div style={{ fontSize: 9.5, fontFamily: V.mono, color: V.muted, textTransform: "uppercase", marginBottom: 5, letterSpacing: "0.04em" }}>Target After-Tax</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button onClick={() => { const v = Math.max(0, target - 10000); setTarget(v); }} style={{ width: 24, height: 24, background: V.card2, border: `1px solid ${V.border}`, borderRadius: 4, color: V.fg, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>−</button>
              <select value={target} onChange={e => { const v = Number(e.target.value); setTarget(v); }} style={{ flex: 1, minWidth: 0, background: V.card2, border: `1px solid ${V.border}`, borderRadius: 4, color: V.accent, fontSize: 12, fontFamily: V.mono, fontWeight: 600, padding: "3px 4px", cursor: "pointer", outline: "none" }}>
                {Array.from({ length: 51 }, (_, i) => i * 10000).map(v => <option key={v} value={v}>{F(v)}</option>)}
              </select>
              <button onClick={() => { const v = Math.min(500000, target + 10000); setTarget(v); }} style={{ width: 24, height: 24, background: V.card2, border: `1px solid ${V.border}`, borderRadius: 4, color: V.fg, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>+</button>
            </div>
          </div>

          {/* Spouse Gross */}
          <div style={{ flex: "0 0 auto" }}>
            <div style={{ fontSize: 9.5, fontFamily: V.mono, color: V.muted, textTransform: "uppercase", marginBottom: 5, letterSpacing: "0.04em" }}>Spouse Gross</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button onClick={() => { const v = Math.max(0, spouseInc - 5000); setSpouseInc(v); }} style={{ width: 24, height: 24, background: V.card2, border: `1px solid ${V.border}`, borderRadius: 4, color: V.fg, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>−</button>
              <select value={spouseInc} onChange={e => { const v = Number(e.target.value); setSpouseInc(v); }} style={{ flex: 1, minWidth: 0, background: V.card2, border: `1px solid ${V.border}`, borderRadius: 4, color: V.fg, fontSize: 12, fontFamily: V.mono, fontWeight: 600, padding: "3px 4px", cursor: "pointer", outline: "none" }}>
                {[0, 3500, ...Array.from({ length: 20 }, (_, i) => (i + 1) * 5000)].map(v => <option key={v} value={v}>{F(v)}</option>)}
              </select>
              <button onClick={() => { const v = Math.min(200000, spouseInc + 5000); setSpouseInc(v); }} style={{ width: 24, height: 24, background: V.card2, border: `1px solid ${V.border}`, borderRadius: 4, color: V.fg, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>+</button>
            </div>
          </div>

          {/* Children <6 */}
          <div style={{ flex: "0 0 auto" }}>
            <div style={{ fontSize: 9.5, fontFamily: V.mono, color: V.muted, textTransform: "uppercase", marginBottom: 5, letterSpacing: "0.04em" }}>Children &lt;6</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button onClick={() => setNU6(Math.max(0, nU6 - 1))} style={{ width: 24, height: 24, background: V.card2, border: `1px solid ${V.border}`, borderRadius: 4, color: V.fg, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>−</button>
              <select value={nU6} onChange={e => setNU6(Number(e.target.value))} style={{ flex: 1, minWidth: 0, background: V.card2, border: `1px solid ${V.border}`, borderRadius: 4, color: V.fg, fontSize: 12, fontFamily: V.mono, fontWeight: 600, padding: "3px 4px", cursor: "pointer", outline: "none" }}>
                {[0,1,2,3,4,5,6].map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <button onClick={() => setNU6(Math.min(6, nU6 + 1))} style={{ width: 24, height: 24, background: V.card2, border: `1px solid ${V.border}`, borderRadius: 4, color: V.fg, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>+</button>
            </div>
          </div>

          {/* Children 6-17 */}
          <div style={{ flex: "0 0 auto" }}>
            <div style={{ fontSize: 9.5, fontFamily: V.mono, color: V.muted, textTransform: "uppercase", marginBottom: 5, letterSpacing: "0.04em" }}>Children 6–17</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button onClick={() => setN617(Math.max(0, n617 - 1))} style={{ width: 24, height: 24, background: V.card2, border: `1px solid ${V.border}`, borderRadius: 4, color: V.fg, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>−</button>
              <select value={n617} onChange={e => setN617(Number(e.target.value))} style={{ flex: 1, minWidth: 0, background: V.card2, border: `1px solid ${V.border}`, borderRadius: 4, color: V.fg, fontSize: 12, fontFamily: V.mono, fontWeight: 600, padding: "3px 4px", cursor: "pointer", outline: "none" }}>
                {[0,1,2,3,4,5,6].map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <button onClick={() => setN617(Math.min(6, n617 + 1))} style={{ width: 24, height: 24, background: V.card2, border: `1px solid ${V.border}`, borderRadius: 4, color: V.fg, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>+</button>
            </div>
          </div>

          {/* A/B Corp Cost */}
          <div style={{ flex: "0 0 auto" }}>
            <div style={{ fontSize: 9.5, fontFamily: V.mono, color: V.muted, textTransform: "uppercase", marginBottom: 5, letterSpacing: "0.04em" }}>A/B Corp Cost</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button onClick={() => { const v = Math.max(0, abCorp - 10000); setAbCorp(v); }} style={{ width: 24, height: 24, background: V.card2, border: `1px solid ${V.border}`, borderRadius: 4, color: V.fg, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>−</button>
              <select value={abCorp} onChange={e => { const v = Number(e.target.value); setAbCorp(v); }} style={{ flex: 1, minWidth: 0, background: V.card2, border: `1px solid ${V.border}`, borderRadius: 4, color: V.fg, fontSize: 12, fontFamily: V.mono, fontWeight: 600, padding: "3px 4px", cursor: "pointer", outline: "none" }}>
                {Array.from({ length: 51 }, (_, i) => i * 10000).map(v => <option key={v} value={v}>{F(v)}</option>)}
              </select>
              <button onClick={() => { const v = Math.min(500000, abCorp + 10000); setAbCorp(v); }} style={{ width: 24, height: 24, background: V.card2, border: `1px solid ${V.border}`, borderRadius: 4, color: V.fg, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>+</button>
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 6, borderRadius: 6, overflow: "hidden", border: `1px solid ${V.border}` }}>
          <div style={{ display: "flex" }}>
            {[["target", `Target: ${F(target)}`], ["ab", `A/B: ${F(abCorp)} Corp Cost`]].map(([k, lbl]) => (
              <button key={k} onClick={() => setMode(k)} style={{ flex: 1, padding: "8px", background: mode === k ? V.accent : V.card, color: mode === k ? "#fff" : V.muted, border: "none", cursor: "pointer", fontSize: 11, fontFamily: V.mono, fontWeight: mode === k ? 600 : 400 }}>{lbl}</button>
            ))}
          </div>
          <div style={{ padding: "8px 14px", background: V.card2, borderTop: `1px solid ${V.border}` }}>
            {mode === "target"
              ? <span style={{ fontSize: 10.5, fontFamily: V.sans, color: V.fg, fontStyle: "italic", opacity: 0.75 }}>Finds the gross salary or dividend that delivers your target after-tax cash, then compares corporate cost.</span>
              : <span style={{ fontSize: 10.5, fontFamily: V.sans, color: V.fg, fontStyle: "italic", opacity: 0.75 }}>Compares after-tax family cash from salary vs. dividend at a fixed corporate cost.</span>
            }
          </div>
        </div>
        <div style={{ marginBottom: 14 }} />

        {/* COMPARISON TABLE */}
        <div style={{ background: V.card, borderRadius: 8, border: `1px solid ${V.border}`, overflow: "hidden", marginBottom: 22 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr", background: V.card2, borderBottom: `1px solid ${V.border}` }}>
            <div style={{ padding: "9px 12px" }} /><div style={{ padding: "9px 12px", textAlign: "right", fontSize: 12, fontWeight: 700, color: V.accent, fontFamily: V.mono }}>Salary</div><div style={{ padding: "9px 12px", textAlign: "right", fontSize: 12, fontWeight: 700, color: V.accent2, fontFamily: V.mono }}>Dividend</div>
          </div>
          {rows.map((r, i) => {
            if (!r) return <div key={i} style={{ height: 1, background: V.border }} />;
            if (r.hdr) return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr", background: V.card2, borderTop: `1px solid ${V.border}`, borderBottom: `1px solid ${V.border}` }}>
                <div style={{ padding: "6px 12px", fontSize: 9, fontFamily: V.mono, color: V.muted, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600, gridColumn: "1 / -1" }}>{r.hdr}</div>
              </div>
            );
            if (r.info) return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr", background: "transparent" }}>
                <div style={{ padding: "4px 12px", display: "flex", alignItems: "baseline", gap: 3 }}>
                  <span title={r.tip || undefined} style={{ fontSize: 10.5, fontFamily: V.mono, color: V.muted, fontStyle: "italic" }}>{r.l}</span>
                  {r.tip && <sup style={{ fontSize: 7, fontWeight: 700, color: V.accent, opacity: 0.6, lineHeight: 1, userSelect: "none" }}>i</sup>}
                </div>
                <div style={{ padding: "4px 12px", textAlign: "right", fontSize: 11.5, fontFamily: V.mono, fontWeight: 500, fontStyle: "italic", color: r.s == null ? V.muted : V.accent }}>{r.s == null ? "—" : F(r.s)}</div>
                <div style={{ padding: "4px 12px", textAlign: "right", fontSize: 11.5, fontFamily: V.mono, fontWeight: 500, fontStyle: "italic", color: r.d == null ? V.muted : V.accent2 }}>{r.d == null ? "—" : F(r.d)}</div>
              </div>
            );
            let sC = V.fg, dC = V.fg;
            if (r.hi && r.s != null && r.d != null) { if (r.s > r.d + 1) sC = V.accent2; else if (r.d > r.s + 1) dC = V.accent2; }
            if (r.lo && r.s != null && r.d != null) { if (r.s < r.d - 1) sC = V.accent2; else if (r.d < r.s - 1) dC = V.accent2; }
            const sStr = r.s == null ? "—" : F(r.s);
            const dStr = r.d == null ? "—" : F(r.d);
            return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr", background: r.hl ? V.card2 : "transparent" }}>
                <div style={{ padding: "5px 12px", paddingLeft: r.indent ? 24 : 12, display: "flex", alignItems: "baseline", gap: 3 }}>
                  <span title={r.tip || undefined} style={{ fontSize: r.indent ? 10.5 : 11, fontFamily: V.mono, color: r.hl ? V.fg : V.muted, fontWeight: r.hl ? 600 : 400 }}>{r.l}</span>
                  {r.tip && <sup style={{ fontSize: 7, fontWeight: 700, color: V.accent, opacity: 0.6, lineHeight: 1, userSelect: "none" }}>i</sup>}
                </div>
                <div style={{ padding: "5px 12px", textAlign: "right", fontSize: 12, fontFamily: V.mono, fontWeight: r.hl ? 700 : 500, color: r.s == null ? V.muted : sC }}>{sStr}</div>
                <div style={{ padding: "5px 12px", textAlign: "right", fontSize: 12, fontFamily: V.mono, fontWeight: r.hl ? 700 : 500, color: r.d == null ? V.muted : dC }}>{dStr}</div>
              </div>
            );
          })}
        </div>

        {/* CALLOUT */}

        {(() => {
          const inTarget = mode === "target";
          const sNull = inTarget && tRes.sN === null;
          const dNull = inTarget && tRes.dN === null;
          const bothNull = sNull && dNull;
          let recLabel, recColor;
          if (bothNull) {
            recLabel = "No solution in range";
            recColor = V.muted;
          } else if (sNull) {
            recLabel = "Dividend";
            recColor = V.accent2;
          } else if (dNull) {
            recLabel = "Salary";
            recColor = V.accent;
          } else {
            const sW = inTarget ? tRes.sN < tRes.dN : sal.familyAfterTax > div.familyAfterTax;
            recLabel = sW ? "Salary" : "Dividend";
            recColor = sW ? V.accent : V.accent2;
          }
          const showSavings = !bothNull;
          const savingsVal = inTarget
            ? (sNull || dNull ? "—" : F(Math.abs((tRes.sal?.corpCost ?? 0) - (tRes.div?.corpCost ?? 0))))
            : F(Math.abs(sal.totalTax - div.totalTax));
          const showAfniDelta = !inTarget || (!sNull && !dNull);
          return (
            <div style={{ background: V.card, borderRadius: 8, border: `1px solid ${recColor}`, marginBottom: 14, overflow: "hidden", display: "flex" }}>
              {/* Recommendation hero */}
              <div style={{ padding: "16px 22px", borderRight: `1px solid ${recColor}30`, display: "flex", flexDirection: "column", justifyContent: "center", flex: "0 0 35%" }}>
                <div style={{ fontSize: 10, fontFamily: V.mono, color: V.muted, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 4 }}>Recommended</div>
                <div style={{ fontSize: bothNull ? 14 : 24, fontWeight: 800, color: recColor, fontFamily: V.sans, letterSpacing: "-0.01em", lineHeight: 1 }}>{recLabel}</div>
              </div>
              {/* Stats row */}
              {(() => {
                const Stat = ({ label, tip, color, children, border }) => (
                  <div title={tip} style={{ flex: "1 1 0", minWidth: 0, padding: "16px 18px", borderRight: border ? `1px solid ${V.border}` : undefined, display: "flex", flexDirection: "column", alignItems: "center", cursor: tip ? "default" : undefined }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 3, marginBottom: 4 }}>
                      <span style={{ fontSize: 11, fontFamily: V.mono, color: V.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
                      {tip && <sup style={{ fontSize: 7, fontWeight: 700, color: V.accent, opacity: 0.6, lineHeight: 1, userSelect: "none" }}>i</sup>}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, fontFamily: V.mono, color }}>{children}</div>
                  </div>
                );
                const savingsTip = inTarget
                  ? (sNull || dNull ? undefined : `Salary requires ${F(tRes.sal?.corpCost)} corp cost (gross salary + ER CPP) to hit ${F(target)} after-tax. Dividend requires ${F(tRes.div?.corpCost)}. Difference: ${F(Math.abs((tRes.sal?.corpCost ?? 0) - (tRes.div?.corpCost ?? 0)))}.`)
                  : `At ${F(abCorp)} corp cost — salary total tax & CPP: ${F(sal?.totalTax)}, dividend: ${F(div?.totalTax)}. Difference: ${F(Math.abs((sal?.totalTax ?? 0) - (div?.totalTax ?? 0)))}.`;
                const beTip = be !== null
                  ? `At ${F(be)} corporate cost, salary and dividend produce identical family after-tax cash. Below this point dividend is preferred; above it salary wins.`
                  : "No break-even found in the $40k–$500k range — one strategy dominates across all modelled corporate costs.";
                return (
                  <div style={{ display: "flex", flexWrap: "nowrap", flex: 1, minWidth: 0 }}>
                    {showSavings && <Stat label={inTarget ? "Corp Cost Savings" : "Tax Savings"} tip={savingsTip} color={recColor} border>{savingsVal}</Stat>}
                    {showAfniDelta && <Stat label="AFNI Δ" tip="Adjusted Family Net Income difference between strategies — dividend AFNI is inflated by the 15% gross-up, reducing CCB and BCFB." color={V.warn} border>{F(Math.abs(sal.familyAFNI - div.familyAFNI))}</Stat>}
                    <Stat label="Break-Even" tip={beTip} color={V.be}>{be !== null ? F(be) : "No crossing"}</Stat>
                  </div>
                );
              })()}
            </div>
          );
        })()}

        {/* WORKPAPERS SIDE BY SIDE */}
        {(() => {
          const allKeys = [
            ...(sal ? sal.trace.sections.map((_, idx) => `sal-${idx}`) : []),
            ...(div ? div.trace.sections.map((_, idx) => `div-${idx}`) : []),
          ];
          const allExpanded = allKeys.length > 0 && allKeys.every(k => openSec[k] === true);
          const toggleAll = () => setOpenSec(Object.fromEntries(allKeys.map(k => [k, !allExpanded])));
          return (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
              <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", marginBottom: -4 }}>
                <button onClick={toggleAll} style={{ fontSize: 10, fontFamily: V.mono, color: V.muted, background: "none", border: `1px solid ${V.border}`, borderRadius: 4, padding: "3px 10px", cursor: "pointer" }}>
                  {allExpanded ? "Collapse All" : "Expand All"}
                </button>
              </div>
              <div style={{ background: V.card, borderRadius: 8, border: `1px solid ${V.accent}30`, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                <div style={{ background: `${V.accent}15`, padding: "9px 12px", borderBottom: `1px solid ${V.border}`, flexShrink: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: V.accent, fontFamily: V.mono }}>Salary Workpaper</div>
                </div>
                <div style={{ overflowY: "auto", maxHeight: 640 }}>
                  {sal ? sal.trace.sections.map((sec, idx) => <Sec key={idx} section={sec} sKey="sal" idx={idx} />) : <div style={{ padding: "20px 12px", fontSize: 11, fontFamily: V.mono, color: V.muted }}>Target not reachable in range</div>}
                </div>
              </div>
              <div style={{ background: V.card, borderRadius: 8, border: `1px solid ${V.accent2}30`, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                <div style={{ background: `${V.accent2}15`, padding: "9px 12px", borderBottom: `1px solid ${V.border}`, flexShrink: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: V.accent2, fontFamily: V.mono }}>Dividend Workpaper</div>
                </div>
                <div style={{ overflowY: "auto", maxHeight: 640 }}>
                  {div ? div.trace.sections.map((sec, idx) => <Sec key={idx} section={sec} sKey="div" idx={idx} />) : <div style={{ padding: "20px 12px", fontSize: 11, fontFamily: V.mono, color: V.muted }}>Target not reachable in range</div>}
                </div>
              </div>
            </div>
          );
        })()}

        {/* QUICK-ADJUST (near graphs) */}
        <div style={{ background: V.card, borderRadius: 8, border: `1px solid ${V.border}`, padding: "10px 14px", marginBottom: 14, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          {/* Target after-tax */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, fontFamily: V.mono, color: V.muted, textTransform: "uppercase", letterSpacing: "0.08em", whiteSpace: "nowrap" }}>Target After-Tax</span>
            <button onClick={() => { const v = Math.max(0, target - 10000); setTarget(v); }} style={{ width: 24, height: 24, background: V.card2, border: `1px solid ${V.border}`, borderRadius: 4, color: V.fg, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
            <select
              value={target}
              onChange={e => { const v = Number(e.target.value); setTarget(v); }}
              style={{ background: V.card2, border: `1px solid ${V.border}`, borderRadius: 4, color: V.accent, fontSize: 13, fontFamily: V.mono, fontWeight: 600, padding: "3px 6px", cursor: "pointer", outline: "none" }}
            >
              {Array.from({ length: 51 }, (_, i) => i * 10000).map(v => (
                <option key={v} value={v}>{F(v)}</option>
              ))}
            </select>
            <button onClick={() => { const v = Math.min(500000, target + 10000); setTarget(v); }} style={{ width: 24, height: 24, background: V.card2, border: `1px solid ${V.border}`, borderRadius: 4, color: V.fg, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
          </div>

          <div style={{ width: 1, height: 20, background: V.border, flexShrink: 0 }} />

          {/* Children */}
          <div style={{ fontSize: 10, fontFamily: V.mono, color: V.muted, textTransform: "uppercase", letterSpacing: "0.08em", flexShrink: 0 }}>Children</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, fontFamily: V.mono, color: V.muted, whiteSpace: "nowrap" }}>Under 6</span>
            <button onClick={() => setNU6(Math.max(0, nU6 - 1))} style={{ width: 24, height: 24, background: V.card2, border: `1px solid ${V.border}`, borderRadius: 4, color: V.fg, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
            <select value={nU6} onChange={e => setNU6(Number(e.target.value))} style={{ background: V.card2, border: `1px solid ${V.border}`, borderRadius: 4, color: V.fg, fontSize: 13, fontFamily: V.mono, fontWeight: 600, padding: "3px 6px", cursor: "pointer", outline: "none" }}>
              {[0,1,2,3,4,5,6].map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <button onClick={() => setNU6(Math.min(6, nU6 + 1))} style={{ width: 24, height: 24, background: V.card2, border: `1px solid ${V.border}`, borderRadius: 4, color: V.fg, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, fontFamily: V.mono, color: V.muted, whiteSpace: "nowrap" }}>6–17</span>
            <button onClick={() => setN617(Math.max(0, n617 - 1))} style={{ width: 24, height: 24, background: V.card2, border: `1px solid ${V.border}`, borderRadius: 4, color: V.fg, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
            <select value={n617} onChange={e => setN617(Number(e.target.value))} style={{ background: V.card2, border: `1px solid ${V.border}`, borderRadius: 4, color: V.fg, fontSize: 13, fontFamily: V.mono, fontWeight: 600, padding: "3px 6px", cursor: "pointer", outline: "none" }}>
              {[0,1,2,3,4,5,6].map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <button onClick={() => setN617(Math.min(6, n617 + 1))} style={{ width: 24, height: 24, background: V.card2, border: `1px solid ${V.border}`, borderRadius: 4, color: V.fg, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
          </div>
          <div style={{ fontSize: 10, fontFamily: V.mono, color: V.muted, marginLeft: "auto" }}>Total kids: <span style={{ color: V.fg, fontWeight: 600 }}>{nU6 + n617}</span></div>
        </div>

        {/* CHARTS */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14, marginBottom: 14 }}>
          <div style={{ background: V.card, borderRadius: 8, border: `1px solid ${V.border}`, padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Family After-Tax Cash</div>
            <Chrt data={rng} k1="sAT" k2="dAT" l1="Salary" l2="Dividend" c1={V.accent} c2={V.accent2}
              dot={recX != null ? { x: recX, y: target } : null}
            />
          </div>
          <div style={{ background: V.card, borderRadius: 8, border: `1px solid ${V.border}`, padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Total Tax & CPP</div>
            <Chrt data={rng} k1="sTx" k2="dTx" l1="Salary" l2="Dividend" c1={V.accent} c2={V.accent2} lowerIsBetter
              dot={recX != null ? { x: recX, y: interpAt(recX, recIsSalary ? "sTx" : "dTx") } : null}
            />
          </div>
          <div style={{ background: V.card, borderRadius: 8, border: `1px solid ${V.border}`, padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>After-Tax Cash Difference (Salary − Dividend)</div>
            <DeltaChrt data={rng}
              dot={recX != null ? { x: recX, y: interpAt(recX, "deltaAT") } : null}
            />
          </div>
        </div>

        {/* FOOTNOTES */}
        <div style={{ background: V.card, borderRadius: 8, border: `1px solid ${V.border}`, padding: 12, fontSize: 10, fontFamily: V.mono, color: V.muted, lineHeight: 1.7 }}>
          <div style={{ fontWeight: 600, color: V.fg, fontSize: 10.5, marginBottom: 3 }}>Rate Sources & Assumptions</div>
          <div>Federal: 14%/20.5%/26%/29%/33% · BPA $16,452 (lowest rate 14%, full year 2026)</div>
          <div>BC: 5.60%/7.70%/10.50%/12.29%/14.70%/16.80%/20.50% · BPA $13,216 (BC Budget 2026 — lowest rate ↑ 5.06%→5.60%)</div>
          <div>Corp SBD: 11% (9% fed + 2% BC) · Non-elig gross-up 15% · Fed DTC 9.0301% · BC DTC ~1.95% of taxable div</div>
          <div>CPP1: YMPE $74,600 · 5.95% · Max $4,230.45/ea · CPP2: YAMPE $85,000 · 4% · Max $416/ea · CPP2 = deduction (s. 60(e.1))</div>
          <div>CCB: $7,997/child &lt;6 · $6,748/child 6–17 · Thresholds $37,487/$81,222 · BCFB approximate</div>
          <div style={{ color: V.warn, marginTop: 3 }}>RRSP deferral value, childcare deductions, AMT, passive income/RDTOH, and s. 110.6 LCGE not modelled. CCB uses projected AFNI. Verify rates before reliance.</div>
        </div>
      </div>
    </div>
  );
}
