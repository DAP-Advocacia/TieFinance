// Tipos compartilhados entre API e telas (somente tipos: seguro para importar no cliente)
export type Role = "admin" | "financeiro" | "aprovador" | "auditoria";
export type Status = "pending" | "approved" | "rejected" | "paid" | "cancelled";

export type PaymentDTO = {
  id: string;
  company_id: string;
  company: string;
  cnpj: string;
  payee_id: string;
  payee: string;
  payee_info: string;
  description: string;
  amount_cents: number;
  pay_date: string;
  cost_center: string;
  status: Status;
  has_attachment: boolean;
  attachment_name: string | null;
  created_by: string;
  created_by_id: string;
  created_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  reason: string | null;
  paid_date: string | null;
  paid_via: string | null;
  paid_ref: string | null;
  overdue: boolean;
  bank_account_id: string | null;
  bank: string;
};

export type AuditDTO = { id: number; ts: string | null; actor: string; action: string; entity: string; entity_id: string; detail: string };
export type CompanyDTO = { id: string; name: string; cnpj: string; active: boolean };
export type BankAccountDTO = { id: string; company_id: string; company: string; bank: string; kind: "extrato" | "api"; nickname: string; agency: string; account: string; active: boolean };
export type PayeeDTO = { id: string; name: string; document: string; payment_info: string; active: boolean };
export type UserDTO = { id: string; name: string; email: string; role: Role; active: boolean };

export type Sum = { count: number; cents: number };
export type Rank = { name: string; cents: number };
export type DashboardDTO = {
  kpis: {
    pending: Sum;
    approved_open: Sum;
    paid_month: Sum;
    overdue: Sum;
    rejected: Sum;
    next7: Sum;
    avg_approval_hours: number | null;
    pending_for_me: number;
    total_live: Sum;
  };
  monthly: { month: string; scheduled_cents: number; paid_cents: number }[];
  by_status: ({ status: Status } & Sum)[];
  by_company: Rank[];
  by_bank: Rank[];
  by_cost_center: Rank[];
  top_payees: Rank[];
  aging: { a_vencer: number; "1_30": number; "31_60": number; "61_90": number; "90_mais": number };
  weeks: { from: string; cents: number }[];
  upcoming: PaymentDTO[];
  recent_audit: AuditDTO[];
};

export type ReconcileLine = {
  line: number;
  description: string;
  date?: string;
  amount_cents?: number;
  result: "match" | "ambiguous" | "unmatched" | "ignored" | "error";
  note?: string;
  payment?: PaymentDTO;
  receivable?: ReceivableDTO;
  candidates?: PaymentDTO[];
};

/** Bancos/instituicoes suportados. "api" = integracao automatica prevista (por ora tambem aceita extrato exportado). */
export const BANKS = [
  { name: "Santander", kind: "extrato" },
  { name: "Bradesco", kind: "extrato" },
  { name: "Nubank", kind: "extrato" },
  { name: "Asaas", kind: "api" },
  { name: "Luna Pay", kind: "api" },
  { name: "EFI Bank", kind: "api" },
  { name: "Outro", kind: "extrato" },
] as const;

export type CustomerDTO = { id: string; name: string; document: string; contact: string; active: boolean };
export type RecvKind = "honorario" | "manutencao" | "avulso";
export type RecvStatus = "open" | "received" | "cancelled";
export const RECV_KINDS: { id: RecvKind; label: string }[] = [
  { id: "honorario", label: "Honorários" },
  { id: "manutencao", label: "Manutenção" },
  { id: "avulso", label: "Avulso" },
];
export type ReceivableDTO = {
  id: string;
  company_id: string;
  company: string;
  bank_account_id: string;
  bank: string;
  customer_id: string;
  customer: string;
  customer_document: string;
  kind: RecvKind;
  description: string;
  amount_cents: number;
  due_date: string;
  status: RecvStatus;
  overdue: boolean;
  days_late: number;
  installment: number;
  installments: number;
  created_by: string;
  received_date: string | null;
  received_via: string | null;
  received_ref: string | null;
  reason: string | null;
};
export type ReceivablesSummaryDTO = {
  open: Sum;
  overdue: Sum;
  received_month: Sum;
  next30: Sum;
  default_rate: number; // % do saldo em aberto que esta vencido
  aging: DashboardDTO["aging"];
  by_customer: Rank[];
};
