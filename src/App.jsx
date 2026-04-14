import { useState, useMemo, useEffect } from "react";

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
    totalTax: allTax, ccb: ccb.amount, bcfb: bcfb.amount,
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
    totalTax: allTax, ccb: ccb.amount, bcfb: bcfb.amount,
    familyAFNI: fAFNI, familyAfterTax: famAT, aAfterTax: aAT,
    spouseAfterTax: sp.afterTax, rrspRoom: minSal * RRSP_RATE,
    trace: { sections },
  };
}

function solve(target, spouseInc, nU6, n617, strat) {
  let lo = 0, hi = 600000;
  for (let i = 0; i < 35; i++) {
    const mid = (lo + hi) / 2;
    const r = strat === "salary" ? salaryFull(mid, spouseInc, nU6, n617) : dividendFull(mid, spouseInc, nU6, n617);
    if (r.familyAfterTax < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function findBE(spouseInc, nU6, n617) {
  let lo = 30000, hi = 400000;
  for (let i = 0; i < 35; i++) {
    const mid = (lo + hi) / 2;
    const s = salaryFull(mid, spouseInc, nU6, n617);
    const d = dividendFull(mid, spouseInc, nU6, n617);
    if (s.familyAfterTax - d.familyAfterTax > 0) lo = mid; else hi = mid;
  }
  if (Math.abs(lo - hi) > 1000) return null;
  return (lo + hi) / 2;
}

// ═══════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════
export default function App() {
  const [target, setTarget] = useState(100000);
  const [targetInput, setTargetInput] = useState("100000");

  const [spouseInc, setSpouseInc] = useState(20000);
  const [spouseIncInput, setSpouseIncInput] = useState("20000");

  const [nU6, setNU6] = useState(2);
  const [n617, setN617] = useState(0);

  const [abCorp, setAbCorp] = useState(150000);
  const [abCorpInput, setAbCorpInput] = useState("150000");

  const [mode, setMode] = useState("target");
  const [openSec, setOpenSec] = useState({});
  const tog = k => setOpenSec(p => ({ ...p, [k]: !p[k] }));
  const commitNumber = (text, setter, fallback) => {
    const n = Number(text);
    if (Number.isFinite(n) && n >= 0) {
      setter(n);
    } else {
      setter(fallback);
    }
  };

  useEffect(() => {
    setTargetInput(String(target));
  }, [target]);

  useEffect(() => {
    setSpouseIncInput(String(spouseInc));
  }, [spouseInc]);

  useEffect(() => {
    setAbCorpInput(String(abCorp));
  }, [abCorp]);

  const tRes = useMemo(() => {
    const sN = solve(target, spouseInc, nU6, n617, "salary");
    const dN = solve(target, spouseInc, nU6, n617, "dividend");
    return {
      sN,
      dN,
      sal: salaryFull(sN, spouseInc, nU6, n617),
      div: dividendFull(dN, spouseInc, nU6, n617),
    };
  }, [target, spouseInc, nU6, n617]);

  const abRes = useMemo(() => ({
    sal: salaryFull(abCorp, spouseInc, nU6, n617),
    div: dividendFull(abCorp, spouseInc, nU6, n617),
  }), [abCorp, spouseInc, nU6, n617]);

  const be = useMemo(() => findBE(spouseInc, nU6, n617), [spouseInc, nU6, n617]);

  const rng = useMemo(() => {
    const p = [];
    for (let c = 40000; c <= 300000; c += 10000) {
      const s = salaryFull(c, spouseInc, nU6, n617);
      const d = dividendFull(c, spouseInc, nU6, n617);
      p.push({ c, sAT: s.familyAfterTax, dAT: d.familyAfterTax, sTx: s.totalTax, dTx: d.totalTax });
    }
    return p;
  }, [spouseInc, nU6, n617]);

  const { sal, div } = mode === "target" ? tRes : abRes;

  const V = {
    bg: "#0c0e14", card: "#151820", card2: "#1a1e2a", border: "#262b3a",
    fg: "#e4e7ef", muted: "#6d7590", accent: "#5b9cf5", accent2: "#3dd9a0",
    warn: "#f5a543", be: "#e879a8", grid: "#1e2230",
    mono: "'JetBrains Mono','SF Mono','Fira Code',Consolas,monospace",
    sans: "'DM Sans','Inter',system-ui,sans-serif",
  };
  const inputS = { width: "100%", padding: "7px 10px", background: V.bg, border: `1px solid ${V.border}`, borderRadius: 6, color: V.fg, fontSize: 14, fontFamily: V.mono, outline: "none", boxSizing: "border-box" };

  const Sec = ({ section, sKey, idx }) => {
    const k = `${sKey}-${idx}`;
    const open = openSec[k] !== false;
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

  const cW = 640, cH = 220, cP = { t: 20, r: 16, b: 36, l: 56 };
  const iW = cW - cP.l - cP.r, iH = cH - cP.t - cP.b;
  const Chrt = ({ data, k1, k2, l1, l2, c1, c2 }) => {
    const aY = data.flatMap(d => [d[k1], d[k2]]);
    const yMn = Math.min(...aY), yMx = Math.max(...aY), yR = yMx - yMn || 1;
    const xMn = data[0].c, xMx = data[data.length - 1].c, xR = xMx - xMn || 1;
    const tX = v => cP.l + ((v - xMn) / xR) * iW;
    const tY = v => cP.t + iH - ((v - yMn) / yR) * iH;
    const p1 = data.map((d, i) => `${i ? "L" : "M"}${tX(d.c)},${tY(d[k1])}`).join("");
    const p2 = data.map((d, i) => `${i ? "L" : "M"}${tX(d.c)},${tY(d[k2])}`).join("");
    const yS = Math.ceil(yR / 4 / 10000) * 10000;
    const yT = [];
    for (let v = Math.floor(yMn / yS) * yS; v <= yMx + yS; v += yS) if (v >= yMn - yS * 0.5 && v <= yMx + yS * 0.5) yT.push(v);
    return (
      <svg viewBox={`0 0 ${cW} ${cH}`} style={{ width: "100%", maxWidth: cW, display: "block" }}>
        {yT.map(v => <g key={v}><line x1={cP.l} y1={tY(v)} x2={cP.l + iW} y2={tY(v)} stroke={V.grid} strokeWidth="0.5" /><text x={cP.l - 6} y={tY(v) + 3.5} fill={V.muted} fontSize="9" textAnchor="end" fontFamily={V.mono}>{Math.round(v / 1000)}k</text></g>)}
        {be && be >= xMn && be <= xMx && <><line x1={tX(be)} y1={cP.t} x2={tX(be)} y2={cP.t + iH} stroke={V.be} strokeWidth="1.5" strokeDasharray="5,3" /><text x={tX(be)} y={cP.t - 3} fill={V.be} fontSize="8.5" textAnchor="middle" fontFamily={V.mono}>B/E {F(be)}</text></>}
        <path d={p1} fill="none" stroke={c1} strokeWidth="2.5" /><path d={p2} fill="none" stroke={c2} strokeWidth="2.5" />
        <rect x={cP.l + 8} y={cP.t + 3} width="10" height="2.5" rx="1" fill={c1} /><text x={cP.l + 22} y={cP.t + 9} fill={V.fg} fontSize="9" fontFamily={V.mono}>{l1}</text>
        <rect x={cP.l + 8} y={cP.t + 14} width="10" height="2.5" rx="1" fill={c2} /><text x={cP.l + 22} y={cP.t + 20} fill={V.fg} fontSize="9" fontFamily={V.mono}>{l2}</text>
        <text x={cW / 2} y={cH - 4} fill={V.muted} fontSize="9.5" textAnchor="middle" fontFamily={V.mono}>Corp Cost / Gross Salary</text>
      </svg>
    );
  };

  const rows = [
    { l: "Corporate Cost", s: sal.corpCost, d: div.corpCost },
    { l: "Corporate Tax (SBD 11%)", s: sal.corpTax, d: div.corpTax },
    { l: "Personal Income Tax", s: sal.personalTax, d: div.personalTax },
    { l: "CPP (EE + ER)", s: sal.cppEe + sal.cppEr, d: 0 },
    { l: "Total Tax & CPP", s: sal.totalTax, d: div.totalTax, hl: true, lo: true },
    null,
    { l: "Family AFNI", s: sal.familyAFNI, d: div.familyAFNI, hl: true, lo: true },
    { l: "CCB", s: sal.ccb, d: div.ccb, hi: true },
    { l: "BCFB", s: sal.bcfb, d: div.bcfb, hi: true },
    null,
    { l: "Family After-Tax Cash", s: sal.familyAfterTax, d: div.familyAfterTax, hl: true, hi: true },
    { l: "RRSP Room", s: sal.rrspRoom, d: div.rrspRoom, hi: true },
  ];

  return (
    <div style={{ background: V.bg, color: V.fg, fontFamily: V.sans, minHeight: "100vh", padding: "20px 14px", boxSizing: "border-box" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, fontFamily: V.mono, color: V.muted, textTransform: "uppercase", letterSpacing: "0.12em" }}>Steven Alexander CPA Inc.</div>
          <h1 style={{ fontSize: 19, fontWeight: 700, margin: "3px 0 0" }}>Salary vs. Dividend — Detailed Workpaper</h1>
          <div style={{ fontSize: 11, fontFamily: V.mono, color: V.muted, marginTop: 2 }}>BC · CCPC SBD · 2026 · Non-eligible dividends · EI exempt</div>
        </div>

        
        
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(125px, 1fr))", gap: 10, background: V.card, borderRadius: 8, padding: 12, border: `1px solid ${V.border}`, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 9.5, fontFamily: V.mono, color: V.muted, textTransform: "uppercase", marginBottom: 3, letterSpacing: "0.04em" }}>
              Target After-Tax
            </div>
            <input
              type="number"
              value={targetInput}
              onChange={e => setTargetInput(e.target.value)}
              onBlur={() => commitNumber(targetInput, setTarget, target)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  commitNumber(targetInput, setTarget, target);
                  e.currentTarget.blur();
                }
              }}
              step={5000}
              style={inputS}
            />
          </div>

          <div>
            <div style={{ fontSize: 9.5, fontFamily: V.mono, color: V.muted, textTransform: "uppercase", marginBottom: 3, letterSpacing: "0.04em" }}>
              Spouse Gross
            </div>
            <input
              type="number"
              value={spouseIncInput}
              onChange={e => setSpouseIncInput(e.target.value)}
              onBlur={() => commitNumber(spouseIncInput, setSpouseInc, spouseInc)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  commitNumber(spouseIncInput, setSpouseInc, spouseInc);
                  e.currentTarget.blur();
                }
              }}
              step={1000}
              style={inputS}
            />
          </div>

          <div>
            <div style={{ fontSize: 9.5, fontFamily: V.mono, color: V.muted, textTransform: "uppercase", marginBottom: 3, letterSpacing: "0.04em" }}>
              Children &lt;6
            </div>
            <input
              type="number"
              value={nU6}
              onChange={e => setNU6(Math.max(0, +e.target.value))}
              step={1}
              style={inputS}
            />
          </div>

          <div>
            <div style={{ fontSize: 9.5, fontFamily: V.mono, color: V.muted, textTransform: "uppercase", marginBottom: 3, letterSpacing: "0.04em" }}>
              Children 6–17
            </div>
            <input
              type="number"
              value={n617}
              onChange={e => setN617(Math.max(0, +e.target.value))}
              step={1}
              style={inputS}
            />
          </div>

          <div>
            <div style={{ fontSize: 9.5, fontFamily: V.mono, color: V.muted, textTransform: "uppercase", marginBottom: 3, letterSpacing: "0.04em" }}>
              A/B Corp Cost
            </div>
            <input
              type="number"
              value={abCorpInput}
              onChange={e => setAbCorpInput(e.target.value)}
              onBlur={() => commitNumber(abCorpInput, setAbCorp, abCorp)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  commitNumber(abCorpInput, setAbCorp, abCorp);
                  e.currentTarget.blur();
                }
              }}
              step={5000}
              style={inputS}
            />
          </div>
        </div>

        <div style={{ display: "flex", marginBottom: 14, borderRadius: 6, overflow: "hidden", border: `1px solid ${V.border}` }}>
          {[["target", `Target: ${F(target)}`], ["ab", `A/B: ${F(abCorp)} Corp Cost`]].map(([k, lbl]) => (
            <button key={k} onClick={() => setMode(k)} style={{ flex: 1, padding: "8px", background: mode === k ? V.accent : V.card, color: mode === k ? "#fff" : V.muted, border: "none", cursor: "pointer", fontSize: 11, fontFamily: V.mono, fontWeight: mode === k ? 600 : 400 }}>{lbl}</button>
          ))}
        </div>

        {/* COMPARISON TABLE */}
        <div style={{ background: V.card, borderRadius: 8, border: `1px solid ${V.border}`, overflow: "hidden", marginBottom: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr", background: V.card2, borderBottom: `1px solid ${V.border}` }}>
            <div style={{ padding: "9px 12px" }} /><div style={{ padding: "9px 12px", textAlign: "right", fontSize: 12, fontWeight: 700, color: V.accent, fontFamily: V.mono }}>Salary</div><div style={{ padding: "9px 12px", textAlign: "right", fontSize: 12, fontWeight: 700, color: V.accent2, fontFamily: V.mono }}>Dividend</div>
          </div>
          {rows.map((r, i) => {
            if (!r) return <div key={i} style={{ height: 1, background: V.border }} />;
            let sC = V.fg, dC = V.fg;
            if (r.hi) { if (r.s > r.d + 1) sC = V.accent2; else if (r.d > r.s + 1) dC = V.accent2; }
            if (r.lo) { if (r.s < r.d - 1) sC = V.accent2; else if (r.d < r.s - 1) dC = V.accent2; }
            return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr", background: r.hl ? V.card2 : "transparent" }}>
                <div style={{ padding: "5px 12px", fontSize: 11, fontFamily: V.mono, color: r.hl ? V.fg : V.muted, fontWeight: r.hl ? 600 : 400 }}>{r.l}</div>
                <div style={{ padding: "5px 12px", textAlign: "right", fontSize: 12, fontFamily: V.mono, fontWeight: r.hl ? 700 : 500, color: sC }}>{F(r.s)}</div>
                <div style={{ padding: "5px 12px", textAlign: "right", fontSize: 12, fontFamily: V.mono, fontWeight: r.hl ? 700 : 500, color: dC }}>{F(r.d)}</div>
              </div>
            );
          })}
        </div>

        {/* CALLOUT */}
        {(() => {
          const sW = mode === "target" ? tRes.sN < tRes.dN : sal.familyAfterTax > div.familyAfterTax;
          const w = sW ? "Salary" : "Dividend", wc = sW ? V.accent : V.accent2;
          return (
            <div style={{ background: V.card, borderRadius: 8, border: `1px solid ${wc}`, padding: 12, marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
              <div style={{ flex: "1 1 140px" }}><div style={{ fontSize: 9.5, fontFamily: V.mono, color: V.muted, textTransform: "uppercase" }}>Recommended</div><div style={{ fontSize: 17, fontWeight: 700, color: wc }}>{w}</div></div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 9.5, fontFamily: V.mono, color: V.muted }}>
                  {mode === "target" ? "Corp Cost Savings" : "Tax Savings"}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, fontFamily: V.mono, color: wc }}>
                  {mode === "target" ? F(Math.abs(tRes.sN - tRes.dN)) : F(Math.abs(sal.totalTax - div.totalTax))}
                </div>
              </div>
              <div style={{ textAlign: "right" }}><div style={{ fontSize: 9.5, fontFamily: V.mono, color: V.muted }}>AFNI Δ</div><div style={{ fontSize: 14, fontWeight: 600, fontFamily: V.mono, color: V.warn }}>{F(Math.abs(sal.familyAFNI - div.familyAFNI))}</div></div>
              {be && <div style={{ textAlign: "right" }}><div style={{ fontSize: 9.5, fontFamily: V.mono, color: V.muted }}>Break-Even</div><div style={{ fontSize: 14, fontWeight: 600, fontFamily: V.mono, color: V.be }}>{F(be)}</div></div>}
            </div>
          );
        })()}

        {/* WORKPAPERS SIDE BY SIDE */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <div style={{ background: V.card, borderRadius: 8, border: `1px solid ${V.accent}30`, overflow: "hidden" }}>
            <div style={{ background: `${V.accent}15`, padding: "9px 12px", borderBottom: `1px solid ${V.border}` }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: V.accent, fontFamily: V.mono }}>Salary Workpaper</div>
            </div>
            {sal.trace.sections.map((sec, idx) => <Sec key={idx} section={sec} sKey="sal" idx={idx} />)}
          </div>
          <div style={{ background: V.card, borderRadius: 8, border: `1px solid ${V.accent2}30`, overflow: "hidden" }}>
            <div style={{ background: `${V.accent2}15`, padding: "9px 12px", borderBottom: `1px solid ${V.border}` }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: V.accent2, fontFamily: V.mono }}>Dividend Workpaper</div>
            </div>
            {div.trace.sections.map((sec, idx) => <Sec key={idx} section={sec} sKey="div" idx={idx} />)}
          </div>
        </div>

        {/* CHARTS */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <div style={{ background: V.card, borderRadius: 8, border: `1px solid ${V.border}`, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6 }}>Family After-Tax Cash</div>
            <Chrt data={rng} k1="sAT" k2="dAT" l1="Salary" l2="Dividend" c1={V.accent} c2={V.accent2} />
          </div>
          <div style={{ background: V.card, borderRadius: 8, border: `1px solid ${V.border}`, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6 }}>Total Tax & CPP</div>
            <Chrt data={rng} k1="sTx" k2="dTx" l1="Salary" l2="Dividend" c1={V.accent} c2={V.accent2} />
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
