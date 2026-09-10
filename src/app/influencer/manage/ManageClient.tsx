'use client';

import { useState, useEffect, useRef } from 'react';
import AppShell from '@/components/AppShell';
import CustomSelect from '@/components/CustomSelect';
import DatePicker from '@/components/DatePicker';
import {
  COLLAB_TYPE_LABELS,
  PARTICIPANT_STATUS_LABELS,
  CAMPAIGN_STATUS_LABELS,
  CHANNEL_LABELS,
  CONTENT_FORMAT_LABELS,
  SETTLEMENT_STAGE_LABELS,
  REVIEW_CATEGORIES,
  FINAL_CONTENT_TYPES,
  SUBMISSION_STATUS_LABELS,
  SUBMISSION_STATUS_COLORS,
  SUBMISSION_STAGE_LABELS,
  isPaidCollab,
  getSettlementStatus,
  getSubmissionDisplayStatus,
  getNextSubmissionAction,
  formatContentFormats,
  type CollabType,
  type CampaignStatus,
  type Channel,
  type ContentFormat,
  type ContentFormatEntry,
  type ProvidedProduct,
  type InfluencerProduct,
  type ProductSet,
  type SettlementStage,
  type SubmissionAsset,
  type SubmissionStage,
} from '@/lib/types/influencer';
import { formatFileSize, formatKRW } from '@/lib/helpers';
import { isParticipantCompletedSimple } from '@/lib/influencer/metrics';

/* ── Types ─────────────────────────────────────────────── */

type ParticipantStatus =
  | 'pending'
  | 'product_sent'
  | 'content_submitted'
  | 'published'
  | 'completed'
  | 'cancelled';

type ConsentStatus = 'not_sent' | 'sent' | 'agreed' | 'expired';
type SettlementDocStatus = 'none' | 'docs_requested' | 'docs_submitted' | 'payment_requested' | 'paid';

interface Participant {
  id: string;
  campaign_id: string;
  name: string;
  display_name: string | null;
  channel: Channel | null;
  handle: string | null;
  profile_url: string | null;
  collab_type: CollabType | null;
  product: string | null;
  product_quantity: number;
  product_cost: number;
  provided_products: ProvidedProduct[];
  product_set_name: string | null;
  content_formats: ContentFormatEntry[];
  fee: number;
  rs_ratio: number | null;
  post_type: string | null;
  post_count: number;
  content_deadline: string | null;
  publish_deadline: string | null;
  secondary_use: boolean;
  secondary_use_period: string | null;
  status: ParticipantStatus;
  consent_status: ConsentStatus;
  consent_token: string | null;
  consent_token_expires_at: string | null;
  consent_agreed_at: string | null;
  consent_ip: string | null;
  settlement_status: SettlementDocStatus;
  settlement_token: string | null;
  settlement_token_expires_at: string | null;
  published_url: string | null;
  phone: string | null;
  planned_draft_date: string | null;
  planned_edit_date: string | null;
  planned_upload_date: string | null;
  confirmed_draft_date: string | null;
  confirmed_edit_date: string | null;
  confirmed_upload_date: string | null;
  draft_received_at: string | null;
  edit_received_at: string | null;
  uploaded_at: string | null;
  comments: string | null;
  delivery_name: string | null;
  delivery_phone: string | null;
  delivery_address: string | null;
  delivery_postal_code: string | null;
  delivery_address_base: string | null;
  delivery_address_detail: string | null;
  memo: string | null;
  bank_name: string | null;
  bank_holder: string | null;
  business_name: string | null;
  _deliverables?: Record<string, { link_url?: string; memo?: string; status?: string; received_at?: string; revision_note?: string; review_category?: string; version?: number; file_url?: string; original_filename?: string; mime_type?: string; file_size?: number; asset_type?: string; content_type?: string; history?: Array<Record<string, unknown>> }>;
}

interface Campaign {
  id: string;
  name: string;
  month: string | null;
  collab_type: CollabType;
  budget: number;
  target_product: string | null;
  advertised_products: string[];
  manager: string | null;
  status: CampaignStatus;
  memo: string | null;
  created_at: string;
  inf_participants: Participant[];
}

/* ── Component ─────────────────────────────────────────── */

export default function ManageClient() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Settings data
  const [settingsProducts, setSettingsProducts] = useState<InfluencerProduct[]>([]);
  const [settingsSets, setSettingsSets] = useState<ProductSet[]>([]);

  // Create/Edit campaign modal
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [editCampaignId, setEditCampaignId] = useState<string | null>(null);
  const [campaignForm, setCampaignForm] = useState({
    name: '',
    month: '',
    advertised_products: [] as string[],
    budget: 0,
    status: 'active' as CampaignStatus,
    memo: '',
  });

  // Campaign ⋯ menu
  const [campaignMenuId, setCampaignMenuId] = useState<string | null>(null);
  const campaignMenuRef = useRef<HTMLDivElement>(null);

  // Participant ⋯ menu
  const [partMenuId, setPartMenuId] = useState<string | null>(null);
  const partMenuRef = useRef<HTMLDivElement>(null);

  // Memo popover
  const [memoTarget, setMemoTarget] = useState<{ type: 'campaign' | 'participant'; id: string; memo: string } | null>(null);
  const [memoText, setMemoText] = useState('');
  // Expanded campaign memo
  const [expandedMemo, setExpandedMemo] = useState<string | null>(null);
  const [campaignMemoEdit, setCampaignMemoEdit] = useState<string | null>(null);

  // Add/Edit participant modal
  const [showPartModal, setShowPartModal] = useState(false);
  const [editPartId, setEditPartId] = useState<string | null>(null);
  const [partCampaignId, setPartCampaignId] = useState<string | null>(null);
  const [partForm, setPartForm] = useState({
    name: '',
    display_name: '',
    channel: '' as string,
    profile_url: '',
    collab_type: 'free_seeding' as CollabType,
    provided_products: [] as ProvidedProduct[],
    product_set_name: '' as string,
    content_formats: [] as ContentFormatEntry[],
    fee: 0,
    rs_ratio: '' as string,
    secondary_use: false,
    secondary_use_period: '',
    memo: '',
  });

  // Submission assets (keyed by campaign id)
  const [submissionAssets, setSubmissionAssets] = useState<Record<string, SubmissionAsset[]>>({});

  // Detail modal
  const [detailPart, setDetailPart] = useState<Participant | null>(null);
  const [detailCampaign, setDetailCampaign] = useState<Campaign | null>(null);

  // Upload confirmation modal
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadPartId, setUploadPartId] = useState<string | null>(null);
  const [uploadForm, setUploadForm] = useState({ upload_date: '', content_url: '' });

  // Delete confirmation modal
  const [deleteModal, setDeleteModal] = useState<{
    type: 'campaign' | 'participant';
    id: string;
    name: string;
    participantCount: number;
    consentCount: number;
    settlementCount: number;
    hasSettlement: boolean;
  } | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Progress slide panel
  const [progressPanel, setProgressPanel] = useState<{ type: 'consent' | 'upload' | 'payment'; participant: Participant } | null>(null);

  // Error message
  const [errorMsg, setErrorMsg] = useState('');
  // Modal saving states + in-modal errors
  const [campaignSaving, setCampaignSaving] = useState(false);
  const [campaignError, setCampaignError] = useState('');
  const [partSaving, setPartSaving] = useState(false);
  const [partError, setPartError] = useState('');
  const [uploadSaving, setUploadSaving] = useState(false);
  const [uploadError, setUploadError] = useState('');
  // Copy toast
  const [copyToast, setCopyToast] = useState(false);
  // Modal drag-close prevention
  const mouseDownRef = useRef<EventTarget | null>(null);

  // Undo confirmation modal (uncheck a completed step)
  const [undoConfirmModal, setUndoConfirmModal] = useState<{
    participantId: string;
    step: string;
    stepLabel: string;
  } | null>(null);
  const [undoConfirmLoading, setUndoConfirmLoading] = useState(false);
  const [undoConfirmError, setUndoConfirmError] = useState('');

  // Edit step modal (reopen receive modal with existing values)
  const [editStepModal, setEditStepModal] = useState<{
    participantId: string;
    step: string;
    stepLabel: string;
    link: string;
    receivedDate: string;
    memo: string;
    processType: 'approved' | 'revision_requested';
    revisionNote: string;
    reviewCategory: string;
    noLink: boolean;
    // File upload fields
    fileUrl: string;
    originalFilename: string;
    mimeType: string;
    fileSize: number;
    // Upload step fields
    contentType: string;
  } | null>(null);
  const [editStepSaving, setEditStepSaving] = useState(false);
  const [editStepError, setEditStepError] = useState('');
  const [editStepUploading, setEditStepUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset modal (participant or campaign)
  const [resetModal, setResetModal] = useState<{
    type: 'participant' | 'campaign';
    id: string;
    name: string;
    confirmName: string;
  } | null>(null);
  const [resetConfirmInput, setResetConfirmInput] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');

  // Manage toast with undo
  const [manageToast, setManageToast] = useState<{
    message: string;
    undoAction?: () => void;
  } | null>(null);
  const manageToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Submit asset modal (register new submission from table)
  const [submitModal, setSubmitModal] = useState<{
    participantId: string;
    participantName: string;
    campaignId: string;
    stage: SubmissionStage;
    stageLabel: string;
  } | null>(null);
  const [submitLink, setSubmitLink] = useState('');
  const [submitSaving, setSubmitSaving] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Drag-and-drop file upload state

  // Fetch settings on mount
  useEffect(() => {
    fetch('/api/influencer/settings')
      .then((r) => r.json())
      .then((d) => {
        if (d && !d.error) {
          setSettingsProducts(d.influencer_products?.products ?? []);
          setSettingsSets(d.influencer_product_sets?.sets ?? []);
        }
      })
      .catch(() => {});
  }, []);

  // Fetch submission assets for a campaign
  const fetchSubmissionAssets = async (campaignId: string) => {
    try {
      const res = await fetch(`/api/influencer/submissions?campaign_id=${campaignId}`);
      const data = await res.json();
      if (data.assets) {
        setSubmissionAssets(prev => ({ ...prev, [campaignId]: data.assets }));
      }
    } catch { /* ignore */ }
  };

  const fetchCampaigns = async () => {
    try {
      const url = filter === 'all' ? '/api/influencer/campaigns' : `/api/influencer/campaigns?status=${filter}`;
      const res = await fetch(url);
      if (!res.ok) { console.error('[fetchCampaigns] HTTP', res.status); }
      const data = await res.json();
      setCampaigns(Array.isArray(data) ? data : []);
      // Refresh submission assets for expanded campaigns
      expanded.forEach(campaignId => fetchSubmissionAssets(campaignId));
    } catch (e) {
      console.error('[fetchCampaigns] error:', e);
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCampaigns(); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch submissions when campaigns expand
  useEffect(() => {
    expanded.forEach(campaignId => {
      if (!submissionAssets[campaignId]) {
        fetchSubmissionAssets(campaignId);
      }
    });
  }, [expanded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close menus on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (campaignMenuId && campaignMenuRef.current && !campaignMenuRef.current.contains(e.target as Node)) setCampaignMenuId(null);
      if (partMenuId && partMenuRef.current && !partMenuRef.current.contains(e.target as Node)) setPartMenuId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [campaignMenuId, partMenuId]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  /* ── Campaign Handlers ─────────────────────────────────── */

  const openCreateCampaign = () => {
    setEditCampaignId(null);
    setCampaignForm({ name: '', month: '', advertised_products: [], budget: 0, status: 'active', memo: '' });
    setShowCampaignModal(true);
  };

  const openEditCampaign = (c: Campaign) => {
    setEditCampaignId(c.id);
    setCampaignForm({
      name: c.name,
      month: c.month || '',
      advertised_products: c.advertised_products ?? [],
      budget: c.budget,
      status: c.status,
      memo: c.memo || '',
    });
    setShowCampaignModal(true);
    setCampaignMenuId(null);
  };

  const handleSaveCampaign = async () => {
    setCampaignSaving(true);
    setCampaignError('');
    try {
      const res = editCampaignId
        ? await fetch('/api/influencer/campaigns', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: editCampaignId, ...campaignForm }),
          })
        : await fetch('/api/influencer/campaigns', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(campaignForm),
          });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setCampaignError(d.error || '저장에 실패했습니다. 다시 시도해주세요.');
        setCampaignSaving(false);
        return;
      }
      setShowCampaignModal(false);
      setCampaignError('');
      fetchCampaigns();
    } catch {
      setCampaignError('네트워크 오류입니다. 다시 시도해주세요.');
    } finally {
      setCampaignSaving(false);
    }
  };

  const openDeleteCampaign = (c: Campaign) => {
    const parts = c.inf_participants ?? [];
    const consentCount = parts.filter((p) => p.consent_status === 'agreed').length;
    const hasSettlementStatus = parts.some((p) =>
      ['docs_submitted', 'payment_requested', 'paid'].includes(p.settlement_status)
    );
    setDeleteModal({
      type: 'campaign',
      id: c.id,
      name: c.name,
      participantCount: parts.length,
      consentCount,
      settlementCount: 0,
      hasSettlement: hasSettlementStatus,
    });
    setDeleteConfirmName('');
    setCampaignMenuId(null);
  };

  const openDeleteParticipant = (p: Participant) => {
    const hasSettlement = ['docs_submitted', 'payment_requested', 'paid'].includes(p.settlement_status);
    setDeleteModal({
      type: 'participant',
      id: p.id,
      name: p.name,
      participantCount: 0,
      consentCount: p.consent_status === 'agreed' ? 1 : 0,
      settlementCount: 0,
      hasSettlement,
    });
    setDeleteConfirmName('');
    setPartMenuId(null);
  };

  const handleDelete = async () => {
    if (!deleteModal) return;
    if (deleteModal.hasSettlement && deleteConfirmName !== deleteModal.name) return;

    setDeleteLoading(true);
    const endpoint = deleteModal.type === 'campaign'
      ? '/api/influencer/campaigns'
      : '/api/influencer/participants';
    const payload: Record<string, unknown> = { id: deleteModal.id };
    if (deleteModal.hasSettlement) payload.confirm_name = deleteConfirmName;

    const res = await fetch(endpoint, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setDeleteLoading(false);

    if (!res.ok) {
      if (data.code === 'confirm_required') {
        setDeleteModal({ ...deleteModal, hasSettlement: true });
        setErrorMsg(data.error);
        setTimeout(() => setErrorMsg(''), 4000);
        return;
      }
      setErrorMsg(data.error || '삭제 실패');
      setTimeout(() => setErrorMsg(''), 4000);
      return;
    }

    setDeleteModal(null);
    if (detailPart?.id === deleteModal.id) { setDetailPart(null); setDetailCampaign(null); }
    fetchCampaigns();
  };

  /* ── Participant Handlers ────────────────────────────── */

  const openAddParticipant = (campaignId: string) => {
    setEditPartId(null);
    setPartCampaignId(campaignId);
    setPartForm({
      name: '', display_name: '', channel: '', profile_url: '',
      collab_type: 'free_seeding', provided_products: [], product_set_name: '',
      content_formats: [], fee: 0, rs_ratio: '',
      secondary_use: false, secondary_use_period: '', memo: '',
    });
    setShowPartModal(true);
  };

  const openEditParticipant = (p: Participant) => {
    setEditPartId(p.id);
    setPartCampaignId(p.campaign_id);
    setPartForm({
      name: p.name,
      display_name: p.display_name || '',
      channel: p.channel || '',
      profile_url: p.profile_url || '',
      collab_type: (p.collab_type as CollabType) || ((p.fee || 0) > 0 ? 'fixed_fee' : 'free_seeding'),
      provided_products: p.provided_products ?? [],
      product_set_name: p.product_set_name || p.product || '',
      content_formats: p.content_formats ?? [],
      fee: p.fee || 0,
      rs_ratio: p.rs_ratio != null ? String(p.rs_ratio) : '',
      secondary_use: p.secondary_use ?? false,
      secondary_use_period: p.secondary_use_period || '',
      memo: p.memo || '',
    });
    setShowPartModal(true);
    setPartMenuId(null);
  };

  const handleSaveParticipant = async () => {
    setPartSaving(true);
    setPartError('');
    try {
      const payload: Record<string, unknown> = {
        name: partForm.name,
        display_name: partForm.display_name || null,
        channel: partForm.channel || null,
        profile_url: partForm.profile_url || null,
        collab_type: partForm.collab_type,
        provided_products: partForm.provided_products,
        product_set_name: partForm.product_set_name || null,
        content_formats: partForm.content_formats,
        fee: isPaidCollab(partForm.collab_type) ? partForm.fee : 0,
        rs_ratio: partForm.collab_type === 'fixed_fee_rs' && partForm.rs_ratio ? parseFloat(partForm.rs_ratio) : null,
        secondary_use: partForm.secondary_use,
        secondary_use_period: partForm.secondary_use_period || null,
        memo: partForm.memo || null,
      };

      let res: Response;
      if (editPartId) {
        payload.id = editPartId;
        res = await fetch('/api/influencer/participants', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        payload.campaign_id = partCampaignId;
        res = await fetch('/api/influencer/participants', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setPartError(d.error || '저장에 실패했습니다. 다시 시도해주세요.');
        setPartSaving(false);
        return;
      }
      setShowPartModal(false);
      setPartError('');
      fetchCampaigns();
    } catch {
      setPartError('네트워크 오류입니다. 다시 시도해주세요.');
    } finally {
      setPartSaving(false);
    }
  };

  const handleUpdateParticipant = async (id: string, updates: Record<string, unknown>) => {
    const res = await fetch('/api/influencer/participants', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...updates }),
    });
    const updated = await res.json();
    if (!res.ok) {
      setErrorMsg(updated.error || '업데이트 실패');
      setTimeout(() => setErrorMsg(''), 4000);
      return;
    }
    fetchCampaigns();
    if (detailPart?.id === id && updated && !updated.error) {
      setDetailPart(updated);
    }
  };

  const getLinkUrl = (token: string, type: 'consent' | 'settlement') => {
    const path = type === 'consent' ? 'consent' : 'settlement';
    return `${window.location.origin}/influencer/${path}/${token}`;
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopyToast(true);
      setTimeout(() => setCopyToast(false), 2000);
    });
  };

  // Show toast with optional undo, auto-dismiss after 5s
  const showManageToast = (message: string, undoAction?: () => void) => {
    if (manageToastTimer.current) clearTimeout(manageToastTimer.current);
    setManageToast({ message, undoAction });
    manageToastTimer.current = setTimeout(() => setManageToast(null), 5000);
  };

  // Handle undo step confirmation
  const handleUndoStepConfirm = async () => {
    if (!undoConfirmModal) return;
    setUndoConfirmLoading(true);
    setUndoConfirmError('');
    try {
      const res = await fetch('/api/influencer/participants/check-step', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participant_id: undoConfirmModal.participantId,
          step: undoConfirmModal.step,
          undo: true,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '알 수 없는 오류' }));
        setUndoConfirmError(err.error || '취소에 실패했습니다');
        return;
      }
      fetchCampaigns();
      if (detailPart?.id === undoConfirmModal.participantId) {
        const stepColMap: Record<string, string> = { draft: 'draft_received_at', edit: 'edit_received_at', upload: 'uploaded_at' };
        const key = stepColMap[undoConfirmModal.step] || 'draft_received_at';
        const updated = { ...detailPart, [key]: null };
        if (undoConfirmModal.step === 'upload') {
          updated.published_url = null;
          updated.status = 'content_submitted';
        }
        const newDlv = { ...(detailPart._deliverables || {}) };
        delete newDlv[undoConfirmModal.step];
        updated._deliverables = newDlv;
        setDetailPart(updated);
      }
      setUndoConfirmModal(null);
      showManageToast(`${undoConfirmModal.stepLabel} 수령 기록이 취소되었습니다`);
    } finally {
      setUndoConfirmLoading(false);
    }
  };

  // Handle file upload for edit step
  const handleEditStepFileUpload = async (file: File) => {
    if (!editStepModal) return;
    setEditStepUploading(true);
    setEditStepError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/influencer/files/upload', { method: 'POST', body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '업로드 실패' }));
        setEditStepError(err.error || '파일 업로드에 실패했습니다');
        return;
      }
      const data = await res.json();
      setEditStepModal({
        ...editStepModal,
        fileUrl: data.url,
        originalFilename: data.original_filename,
        mimeType: data.mime_type,
        fileSize: data.file_size,
        noLink: true,
      });
    } finally {
      setEditStepUploading(false);
    }
  };

  // Handle edit step save
  const handleEditStepSave = async () => {
    if (!editStepModal) return;
    const isFileStep = editStepModal.step === 'edit' && editStepModal.fileUrl;
    const isUploadStep = editStepModal.step === 'upload';
    if (!isFileStep && !editStepModal.noLink && !editStepModal.link.trim()) {
      setEditStepError(isUploadStep ? '콘텐츠 URL을 입력하세요' : '링크를 입력하세요');
      return;
    }
    if (editStepModal.processType === 'revision_requested' && !editStepModal.revisionNote.trim()) {
      setEditStepError('수정 요청 사유를 입력하세요');
      return;
    }
    if (isUploadStep && !editStepModal.contentType) {
      setEditStepError('콘텐츠 유형을 선택하세요');
      return;
    }
    setEditStepSaving(true);
    setEditStepError('');
    try {
      const payload: Record<string, unknown> = {
        participant_id: editStepModal.participantId,
        step: editStepModal.step,
        link: editStepModal.noLink && !isFileStep ? '' : editStepModal.link.trim(),
        memo: editStepModal.memo.trim(),
        received_at: editStepModal.receivedDate ? new Date(editStepModal.receivedDate + 'T00:00:00+09:00').toISOString() : undefined,
        status: editStepModal.processType,
        revision_note: editStepModal.processType === 'revision_requested' ? editStepModal.revisionNote.trim() : undefined,
        review_category: editStepModal.processType === 'revision_requested' ? editStepModal.reviewCategory : undefined,
      };
      // File fields
      if (editStepModal.fileUrl) {
        payload.file_url = editStepModal.fileUrl;
        payload.original_filename = editStepModal.originalFilename;
        payload.mime_type = editStepModal.mimeType;
        payload.file_size = editStepModal.fileSize;
      }
      // Content type for upload step
      if (editStepModal.contentType) {
        payload.content_type = editStepModal.contentType;
      }
      const res = await fetch('/api/influencer/participants/check-step', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '알 수 없는 오류' }));
        setEditStepError(err.error || '저장에 실패했습니다');
        return;
      }
      const result = await res.json();
      fetchCampaigns();
      if (detailPart?.id === editStepModal.participantId) {
        const stepColMap: Record<string, string> = { draft: 'draft_received_at', edit: 'edit_received_at', upload: 'uploaded_at' };
        const key = stepColMap[editStepModal.step];
        const updated = { ...detailPart };
        if (editStepModal.processType !== 'revision_requested') {
          (updated as Record<string, unknown>)[key] = result.value;
          if (editStepModal.step === 'upload' && editStepModal.link) {
            updated.published_url = editStepModal.link.trim();
            updated.status = 'published';
          }
        }
        const newDlv = { ...(detailPart._deliverables || {}) };
        if (result.deliverable) {
          newDlv[editStepModal.step] = result.deliverable;
        }
        updated._deliverables = newDlv;
        setDetailPart(updated);
      }
      setEditStepModal(null);
      const isUndo = editStepModal.processType !== 'revision_requested';
      showManageToast(
        editStepModal.processType === 'revision_requested'
          ? '수정 요청으로 기록했습니다'
          : `${editStepModal.stepLabel} ${editStepModal.step === 'upload' ? '확인' : '수정'} 완료`,
        isUndo ? () => {
          // Undo the save
          fetch('/api/influencer/participants/check-step', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              participant_id: editStepModal.participantId,
              step: editStepModal.step,
              undo: true,
            }),
          }).then(() => {
            fetchCampaigns();
            setManageToast(null);
          });
        } : undefined,
      );
    } finally {
      setEditStepSaving(false);
    }
  };

  // Handle reset
  const handleResetConfirm = async () => {
    if (!resetModal) return;
    if (resetConfirmInput !== resetModal.confirmName) return;
    setResetLoading(true);
    setResetError('');
    try {
      const res = await fetch('/api/influencer/participants/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          resetModal.type === 'participant'
            ? { type: 'participant', participant_id: resetModal.id }
            : { type: 'campaign', campaign_id: resetModal.id },
        ),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '알 수 없는 오류' }));
        setResetError(err.error || '초기화에 실패했습니다');
        return;
      }
      fetchCampaigns();
      if (detailPart && resetModal.type === 'participant' && detailPart.id === resetModal.id) {
        setDetailPart({
          ...detailPart,
          draft_received_at: null,
          edit_received_at: null,
          uploaded_at: null,
          published_url: null,
          _deliverables: {},
        });
      }
      if (resetModal.type === 'campaign' && detailPart) {
        // Refresh detail if the current participant belongs to this campaign
        setDetailPart(null);
      }
      setResetModal(null);
      setResetConfirmInput('');
      showManageToast('진행 기록이 초기화되었습니다');
    } finally {
      setResetLoading(false);
    }
  };

  // Inline approve asset (no modal)
  const handleApproveAsset = async (assetId: string) => {
    try {
      const res = await fetch('/api/influencer/submissions/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_id: assetId, action: 'approved' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '알 수 없는 오류' }));
        alert(err.error || '확인 완료 처리에 실패했습니다');
        return;
      }
      // Refresh submission assets for all expanded campaigns
      expanded.forEach(cid => fetchSubmissionAssets(cid));
      showManageToast('확인 완료 처리했습니다');
    } catch {
      alert('네트워크 오류입니다. 다시 시도해주세요.');
    }
  };

  // Submit new asset (from table [등록] button)
  const handleSubmitAsset = async () => {
    if (!submitModal || !submitLink.trim()) return;
    setSubmitSaving(true);
    setSubmitError('');
    try {
      const res = await fetch('/api/influencer/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participant_id: submitModal.participantId,
          stage: submitModal.stage,
          external_url: submitLink.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '알 수 없는 오류' }));
        setSubmitError(err.error || '등록에 실패했습니다');
        return;
      }
      fetchSubmissionAssets(submitModal.campaignId);
      setSubmitModal(null);
      setSubmitLink('');
      showManageToast(`${submitModal.stageLabel} 등록 완료`);
    } catch {
      setSubmitError('네트워크 오류입니다. 다시 시도해주세요.');
    } finally {
      setSubmitSaving(false);
    }
  };


  const openUploadModal = (p: Participant) => {
    setUploadPartId(p.id);
    setUploadForm({
      upload_date: p.planned_upload_date || new Date().toISOString().slice(0, 10),
      content_url: p.published_url || '',
    });
    setShowUploadModal(true);
    setPartMenuId(null);
  };

  const handleUploadConfirm = async () => {
    if (!uploadPartId || !uploadForm.content_url) return;
    setUploadSaving(true);
    setUploadError('');
    try {
      const res = await fetch('/api/influencer/participants', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: uploadPartId,
          published_url: uploadForm.content_url,
          planned_upload_date: uploadForm.upload_date || new Date().toISOString().slice(0, 10),
          status: 'published',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUploadError(data.error || '저장에 실패했습니다. 다시 시도해주세요.');
        setUploadSaving(false);
        return;
      }
      if (detailPart?.id === uploadPartId && data && !data.error) {
        setDetailPart(data);
      }
      setShowUploadModal(false);
      setUploadPartId(null);
      setUploadForm({ upload_date: '', content_url: '' });
      setUploadError('');
      fetchCampaigns();
    } catch {
      setUploadError('네트워크 오류입니다. 다시 시도해주세요.');
    } finally {
      setUploadSaving(false);
    }
  };

  /* ── Product Set helpers ──────────────────────────────── */

  const toggleContentFormat = (format: ContentFormat) => {
    const existing = partForm.content_formats.find((f) => f.format === format);
    if (existing) {
      setPartForm({ ...partForm, content_formats: partForm.content_formats.filter((f) => f.format !== format) });
    } else {
      setPartForm({ ...partForm, content_formats: [...partForm.content_formats, { format, count: 1 }] });
    }
  };

  /* ── Helpers ──────────────────────────────────────────── */

  const fmtKRW = (n: number) => n > 0 ? formatKRW(n) : '-';

  /* ── Memo helpers ─────────────────────────────────────── */

  const MemoIcon = ({ hasMemo, size = 12 }: { hasMemo: boolean; size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path d="M3 2.5h10c.83 0 1.5.67 1.5 1.5v7c0 .83-.67 1.5-1.5 1.5H6l-3 2.5V4c0-.83.67-1.5 1.5-1.5Z" stroke={hasMemo ? '#9AA2AA' : '#C4CAD1'} strokeWidth="1.2" fill="none" />
      {hasMemo && <circle cx="8" cy="7.5" r="1" fill="#9AA2AA" />}
    </svg>
  );

  const openMemoPopover = (type: 'campaign' | 'participant', id: string, memo: string | null) => {
    setMemoTarget({ type, id, memo: memo || '' });
    setMemoText(memo || '');
  };

  const saveMemo = async () => {
    if (!memoTarget) return;
    const endpoint = memoTarget.type === 'campaign' ? '/api/influencer/campaigns' : '/api/influencer/participants';
    await fetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: memoTarget.id, memo: memoText || null }),
    });
    setMemoTarget(null);
    fetchCampaigns();
  };

  /* ── Progress dots (3-stage: 동의서·업로드·지급) ───────── */

  const ProgressDots = ({ p }: { p: Participant }) => {
    const consentDone = p.consent_status === 'agreed';
    const uploadDone = !!p.uploaded_at;
    const stage = getSettlementStatus(p);
    const paidDone = p.settlement_status === 'paid';
    const paymentWaiting = stage === 'payment_waiting';
    const hasFee = (p.fee || 0) > 0;

    const dotStyle = (done: boolean, active?: boolean): React.CSSProperties => ({
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: done ? '#4A7DB5' : active ? '#1A1D21' : 'transparent',
      border: done ? 'none' : '1.5px solid #E4E8EC',
      flexShrink: 0,
      cursor: done ? 'pointer' : 'default',
    });

    const labelStyle = (done: boolean): React.CSSProperties => ({
      fontSize: 10,
      color: done ? '#4A7DB5' : '#9AA2AA',
      whiteSpace: 'nowrap',
      cursor: done ? 'pointer' : 'default',
    });

    const handleDotClick = (type: 'consent' | 'upload' | 'payment', done: boolean) => {
      if (done) setProgressPanel({ type, participant: p });
    };

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
          onClick={(e) => { e.stopPropagation(); handleDotClick('consent', consentDone); }}>
          <div style={dotStyle(consentDone, p.consent_status === 'sent')} />
          <span style={labelStyle(consentDone)}>동의서</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
          onClick={(e) => { e.stopPropagation(); handleDotClick('upload', uploadDone); }}>
          <div style={dotStyle(uploadDone)} />
          <span style={labelStyle(uploadDone)}>업로드</span>
        </div>
        {hasFee && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
            onClick={(e) => { e.stopPropagation(); handleDotClick('payment', paidDone || paymentWaiting); }}>
            <div style={dotStyle(paidDone, paymentWaiting)} />
            <span style={labelStyle(paidDone)}>지급</span>
          </div>
        )}
      </div>
    );
  };

  /* ── Next action button ──────────────────────────────── */

  const getNextAction = (p: Participant, c: Campaign): { label: string; onClick: () => void } | null => {
    const hasFee = isPaidCollab(p.collab_type) || (p.fee || 0) > 0;

    // 1. Consent not sent → generate
    if (p.consent_status === 'not_sent') {
      return { label: '동의서', onClick: () => handleUpdateParticipant(p.id, { generate_consent_token: true }) };
    }
    // 2. Consent sent → copy link
    if (p.consent_status === 'sent' && p.consent_token) {
      return { label: '링크 복사', onClick: () => copyToClipboard(getLinkUrl(p.consent_token!, 'consent')) };
    }
    // 3. Consent agreed, no upload → upload confirm
    if (p.consent_status === 'agreed' && !p.published_url) {
      return { label: '업로드', onClick: () => openUploadModal(p) };
    }
    // 4. Upload done, no settlement link, has fee → generate settlement
    if (p.published_url && hasFee && p.settlement_status === 'none') {
      return { label: '정산링크', onClick: () => handleUpdateParticipant(p.id, { generate_settlement_token: true }) };
    }
    // 5. Settlement link sent → copy
    if (p.settlement_status === 'docs_requested' && p.settlement_token) {
      return { label: '링크 복사', onClick: () => copyToClipboard(getLinkUrl(p.settlement_token!, 'settlement')) };
    }
    // 6. Settlement docs submitted → payment
    if (p.settlement_status === 'docs_submitted') {
      return { label: '지급', onClick: () => { setDetailPart(p); setDetailCampaign(c); } };
    }

    return null;
  };

  /* ── Styles ──────────────────────────────────────────── */

  const sectionStyle: React.CSSProperties = {
    background: 'var(--surface)', border: 'var(--card-border)',
    borderRadius: 'var(--card-radius)', marginBottom: 'var(--card-gap)', overflow: 'hidden',
  };
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', border: '1px solid var(--border)',
    borderRadius: 8, fontSize: 14, fontFamily: 'var(--font)',
    background: 'var(--surface)', color: 'var(--text-primary)',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'block',
  };
  const hintStyle: React.CSSProperties = { fontSize: 11, color: 'var(--text-muted)', marginTop: 2 };

  const campaignStatusBadge = (status: CampaignStatus) => {
    // P0-3: greyscale only for normal states
    const isGrey = status === 'active' || status === 'preparing' || status === 'completed';
    const c = isGrey ? '#8E959D' : status === 'cancelled' ? '#8E959D' : '#8E959D';
    const bg = '#F2F4F7';
    return (
      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 500, color: c, background: bg }}>
        {CAMPAIGN_STATUS_LABELS[status]}
      </span>
    );
  };

  const modalOverlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
  };
  const modalContent: React.CSSProperties = {
    background: 'var(--surface)', borderRadius: 12, padding: '24px',
    width: 520, maxHeight: '85vh', overflowY: 'auto',
  };
  const btnPrimary: React.CSSProperties = {
    padding: '8px 20px', background: '#1A1D21', color: '#fff',
    border: 'none', borderRadius: 10, fontSize: 13.5, fontWeight: 550,
    height: 36, cursor: 'pointer', fontFamily: 'var(--font)',
  };
  const btnGhost: React.CSSProperties = {
    padding: '8px 16px', background: 'none', border: '1px solid var(--border)',
    borderRadius: 8, fontSize: 14, cursor: 'pointer', color: 'var(--text-secondary)',
    fontFamily: 'var(--font)',
  };
  const btnSmall: React.CSSProperties = {
    padding: '3px 10px', background: 'none', border: '1px solid var(--border)',
    borderRadius: 6, fontSize: 12, cursor: 'pointer', color: 'var(--text-secondary)',
    whiteSpace: 'nowrap', fontFamily: 'var(--font)',
  };
  const chipStyle = (active: boolean): React.CSSProperties => ({
    padding: '4px 12px', borderRadius: 16, fontSize: 13,
    border: active ? '1px solid var(--text-primary)' : '1px solid var(--border)',
    background: active ? 'var(--text-primary)' : 'transparent',
    color: active ? '#fff' : 'var(--text-secondary)', cursor: 'pointer',
  });

  /* ── ⋯ Menu component ──────────────────────────────── */

  const EllipsisMenu = ({ items, menuRef }: { items: { label: string; onClick: () => void; danger?: boolean }[]; menuRef: React.RefObject<HTMLDivElement | null> }) => (
    <div
      ref={menuRef}
      style={{
        position: 'absolute', top: 'calc(100% + 4px)', right: 0,
        background: '#FFFFFF', border: '1px solid #EDF0F3', borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.10)', zIndex: 100, padding: '4px 0',
        minWidth: 140, animation: 'selectSlideIn 0.12s ease-out',
      }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          onClick={(e) => { e.stopPropagation(); item.onClick(); }}
          style={{
            display: 'block', width: '100%', padding: '7px 14px',
            background: 'none', border: 'none', fontSize: 13,
            color: item.danger ? '#D9534F' : '#1A1D21',
            textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--font)',
          }}
          onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#F2F4F7'; }}
          onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'none'; }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );

  const EllipsisBtn = ({ onClick }: { onClick: (e: React.MouseEvent) => void }) => (
    <button
      onClick={onClick}
      style={{
        background: 'none', border: 'none', cursor: 'pointer', fontSize: 16,
        color: '#9AA2AA', padding: '2px 6px', borderRadius: 4, fontFamily: 'var(--font)',
        lineHeight: 1,
      }}
      onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#F2F4F7'; }}
      onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'none'; }}
    >
      ⋯
    </button>
  );

  /* ── Column widths ────────────────────────── */
  const colW = {
    name: '18%', product: '12%', fee: '10%',
    status: '12%', progress: '16%',
    subProposal: '8%', subRoughCut: '8%', subUpload: '8%',
    nextAction: '10%', menu: '4%',
  };

  /* ── Render ──────────────────────────────────────────── */
  return (
    <AppShell showFilter={false}>
      <div>
        {errorMsg && (
          <div style={{ background: '#FEE2E2', color: '#DC2626', padding: '8px 16px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{errorMsg}</div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>캠페인 관리</h1>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <CustomSelect
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: '전체' },
                { value: 'preparing', label: '준비 중' },
                { value: 'active', label: '진행 중' },
                { value: 'completed', label: '완료' },
                { value: 'cancelled', label: '취소' },
              ]}
              size="md"
            />
            <button style={btnPrimary} onClick={openCreateCampaign}>+ 캠페인 생성</button>
          </div>
        </div>
        {loading && <p style={{ color: 'var(--text-muted)' }}>로딩 중...</p>}
        {!loading && campaigns.length === 0 && filter === 'all' && (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>데이터를 불러올 수 없습니다. 새로고침을 시도하세요.</p>
        )}

        {campaigns.map((c) => {
          const isOpen = expanded.has(c.id);
          const parts = c.inf_participants ?? [];
          const totalFee = parts.reduce((s, p) => s + (p.fee || 0), 0);
          const allUnpaid = parts.length > 0 && parts.every((p) => !isPaidCollab(p.collab_type) && (p.fee || 0) === 0);
          const consentAgreed = parts.filter((p) => p.consent_status === 'agreed').length;
          const completedCount = parts.filter((p) =>
            isParticipantCompletedSimple({
              fee: Number(p.fee) || 0,
              uploaded_at: p.uploaded_at,
              settlement_status: p.settlement_status,
            }),
          ).length;
          const budgetPct = c.budget > 0 ? Math.round((totalFee / c.budget) * 100) : 0;

          return (
            <div key={c.id} style={sectionStyle}>
              <div
                onClick={() => toggleExpand(c.id)}
                style={{ padding: '16px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: isOpen ? '1px solid var(--border)' : 'none' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>&#9654;</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {c.name}
                      {campaignStatusBadge(c.status)}
                      {c.memo && (
                        <span
                          style={{ cursor: 'pointer', display: 'inline-flex' }}
                          onClick={(e) => { e.stopPropagation(); setExpandedMemo(expandedMemo === c.id ? null : c.id); }}
                          title="메모 보기"
                        >
                          <MemoIcon hasMemo size={12} />
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      {c.month || ''}{c.month ? ' · ' : ''}참여자 {parts.length}명
                      {completedCount > 0 && ` · ${completedCount}명 완료`}
                      {(() => {
                        const pAssets = submissionAssets[c.id] || [];
                        const needsReview = parts.filter(p => {
                          const pa = pAssets.filter(a => a.participant_id === p.id);
                          return (['proposal', 'rough_cut', 'final_upload'] as SubmissionStage[]).some(s => getSubmissionDisplayStatus(pa, s).status === 'received');
                        }).length;
                        return needsReview > 0 ? ` · 확인 필요 ${needsReview}건` : '';
                      })()}
                      {!allUnpaid && totalFee > 0 && ` · 집행 ${totalFee.toLocaleString()}원`}
                      {!allUnpaid && c.budget > 0 && ` · 예산 ${c.budget.toLocaleString()}원`}
                      {!allUnpaid && c.budget > 0 && (
                        <span style={budgetPct > 100 ? { color: '#D9534F', fontWeight: 600 } : undefined}>
                          {` · 소진 ${budgetPct}%`}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, position: 'relative' }}>
                  <div style={{ position: 'relative' }}>
                    <EllipsisBtn onClick={(e) => { e.stopPropagation(); setCampaignMenuId(campaignMenuId === c.id ? null : c.id); }} />
                    {campaignMenuId === c.id && (
                      <EllipsisMenu
                        menuRef={campaignMenuRef}
                        items={[
                          { label: '캠페인 수정', onClick: () => openEditCampaign(c) },
                          { label: '모든 참여자 진행 초기화', onClick: () => { setResetModal({ type: 'campaign', id: c.id, name: c.name, confirmName: c.name }); setResetConfirmInput(''); setResetError(''); setCampaignMenuId(null); } },
                          { label: '캠페인 삭제', onClick: () => openDeleteCampaign(c), danger: true },
                        ]}
                      />
                    )}
                  </div>
                </div>
              </div>

              {isOpen && (
                <div style={{ padding: '12px 20px 16px' }}>
                  {/* Campaign memo inline edit */}
                  {expandedMemo === c.id && (
                    <div style={{ marginBottom: 12, padding: '10px 12px', background: 'var(--gray-badge-bg)', borderRadius: 8 }}>
                      <textarea
                        style={{ ...inputStyle, minHeight: 48, fontSize: 13, background: 'var(--surface)' }}
                        value={campaignMemoEdit ?? c.memo ?? ''}
                        onChange={(e) => setCampaignMemoEdit(e.target.value)}
                        onFocus={() => { if (campaignMemoEdit === null) setCampaignMemoEdit(c.memo || ''); }}
                        placeholder="캠페인 메모"
                      />
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 6 }}>
                        <button style={{ ...btnSmall, fontSize: 11 }} onClick={() => { setExpandedMemo(null); setCampaignMemoEdit(null); }}>닫기</button>
                        <button style={{ ...btnSmall, fontSize: 11 }} onClick={async () => {
                          await fetch('/api/influencer/campaigns', {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: c.id, memo: campaignMemoEdit || null }),
                          });
                          setExpandedMemo(null);
                          setCampaignMemoEdit(null);
                          fetchCampaigns();
                        }}>저장</button>
                      </div>
                    </div>
                  )}

                  <>
                  {/* Hover action CSS */}
                  <style>{`.uc:hover .ua{display:flex!important}`}</style>

                  {(() => {
                    const campCollab = c.collab_type || 'fixed_fee';
                    const showProposal = campCollab !== 'free_seeding';
                    const showRoughCut = campCollab !== 'free_seeding';
                    const showSettlement = isPaidCollab(campCollab);
                    const isFreeSeed = campCollab === 'free_seeding';
                    const campAssets = submissionAssets[c.id] || [];

                    // Sort participants: 1) has 확인필요 2) revision ≥3d 3) in-progress 4) completed
                    const sorted = [...parts].sort((a, b) => {
                      const aAssets = campAssets.filter(x => x.participant_id === a.id);
                      const bAssets = campAssets.filter(x => x.participant_id === b.id);
                      const stages: SubmissionStage[] = ['proposal', 'rough_cut', 'final_upload'];
                      const hasReceived = (assets: SubmissionAsset[]) => stages.some(s => getSubmissionDisplayStatus(assets, s).status === 'received');
                      const hasOverdue = (assets: SubmissionAsset[]) => stages.some(s => { const d = getSubmissionDisplayStatus(assets, s); return d.status === 'revision_requested' && (d.daysSinceRevision ?? 0) >= 3; });
                      const allDone = (assets: SubmissionAsset[], part: Participant) => {
                        const allApproved = stages.every(s => getSubmissionDisplayStatus(assets, s).status === 'approved' || getSubmissionDisplayStatus(assets, s).status === 'not_received');
                        return allApproved && !!part.published_url;
                      };

                      const aR = hasReceived(aAssets) ? 0 : 1;
                      const bR = hasReceived(bAssets) ? 0 : 1;
                      if (aR !== bR) return aR - bR;

                      const aO = hasOverdue(aAssets) ? 0 : 1;
                      const bO = hasOverdue(bAssets) ? 0 : 1;
                      if (aO !== bO) return aO - bO;

                      const aD = allDone(aAssets, a) ? 1 : 0;
                      const bD = allDone(bAssets, b) ? 1 : 0;
                      return aD - bD;
                    });

                    // Submission cell renderer
                    const STAGE_LABELS_MAP: Record<string, string> = { proposal: '기획안', rough_cut: '가편집본', final_upload: '최종 업로드' };

                    const renderSubCell = (pId: string, stage: SubmissionStage, pName?: string) => {
                      const pAssets = campAssets.filter(a => a.participant_id === pId);
                      const ds = getSubmissionDisplayStatus(pAssets, stage);
                      const latest = pAssets.filter(a => a.stage === stage).sort((a, b) => b.version - a.version)[0];
                      const isOverdue = ds.status === 'revision_requested' && (ds.daysSinceRevision ?? 0) >= 3;

                      // Color rules per spec: only 확인 필요 = orange, 수정본 대기 3일+ = red, others = no bg
                      const bg = ds.status === 'received' ? '#FDF4E7'
                        : isOverdue ? '#FBE9E8'
                        : undefined;
                      const statusKey = isOverdue ? 'revision_overdue' : ds.status;
                      const color = SUBMISSION_STATUS_COLORS[statusKey] || '#8A9199';

                      if (ds.status === 'not_received') {
                        const openRegister = () => {
                          setSubmitModal({ participantId: pId, participantName: pName || '', campaignId: c.id, stage, stageLabel: STAGE_LABELS_MAP[stage] || stage });
                          setSubmitLink('');
                          setSubmitError('');
                        };
                        return (
                          <td style={{ verticalAlign: 'middle', padding: '8px 6px', textAlign: 'center' }}>
                            <span
                              style={{ fontSize: 11, color: '#9AA2AA', cursor: 'pointer', textDecoration: 'none' }}
                              onClick={(e) => { e.stopPropagation(); openRegister(); }}
                              onMouseEnter={(e) => { (e.target as HTMLElement).style.color = '#2563EB'; }}
                              onMouseLeave={(e) => { (e.target as HTMLElement).style.color = '#9AA2AA'; }}
                            >등록</span>
                          </td>
                        );
                      }

                      const fmtDate = (iso: string) => { const d = new Date(iso); return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`; };

                      return (
                        <td className="uc" style={{ verticalAlign: 'middle', padding: '8px 6px', position: 'relative', textAlign: 'center', background: bg }}>
                          {/* Row 1: Asset link */}
                          <div style={{ fontSize: 12, marginBottom: 1 }}>
                            {latest?.external_url ? (
                              <a href={latest.external_url} target="_blank" rel="noopener noreferrer" style={{ color: '#2563EB', textDecoration: 'none' }}>
                                🔗 {stage === 'rough_cut' ? `v${latest.version}` : '링크'}
                              </a>
                            ) : latest?.file_path ? (
                              <span style={{ color: '#2563EB', cursor: 'pointer' }}>🎥 v{latest.version}{latest.file_size ? ` · ${formatFileSize(latest.file_size)}` : ''}</span>
                            ) : null}
                          </div>
                          {/* Row 2: Status */}
                          <div style={{ color, fontSize: 11, fontWeight: 500 }}>
                            {ds.status === 'approved' && '✓ '}{ds.status === 'revision_requested' && '⚠ '}
                            {SUBMISSION_STATUS_LABELS[ds.status]}
                          </div>
                          {/* Row 3: Date / revision info */}
                          <div style={{ fontSize: 10, color: '#9AA2AA', marginTop: 1 }}>
                            {ds.status === 'received' && latest?.received_at && `${fmtDate(latest.received_at)} 수령`}
                            {ds.status === 'approved' && latest?.reviews?.[0]?.created_at && `${fmtDate(latest.reviews[0].created_at)}`}
                            {ds.status === 'revision_requested' && (isOverdue ? `${ds.daysSinceRevision}일 경과` : `요청 ${ds.daysSinceRevision ?? 0}일`)}
                          </div>
                          {/* Hover inline actions */}
                          <div className="ua" style={{ display: 'none', position: 'absolute', top: 2, right: 2, gap: 3, zIndex: 5 }}>
                            {ds.status === 'received' && (
                              <>
                                <button style={{ padding: '2px 6px', fontSize: 10, borderRadius: 4, border: 'none', background: '#1A1D21', color: '#fff', cursor: 'pointer' }}
                                  onClick={(e) => { e.stopPropagation(); handleApproveAsset(latest!.id); }}>확인 완료</button>
                              </>
                            )}
                            {latest?.external_url && (
                              <button style={{ padding: '2px 6px', fontSize: 10, borderRadius: 4, border: '1px solid var(--border)', background: '#fff', cursor: 'pointer' }}
                                onClick={(e) => { e.stopPropagation(); window.open(latest.external_url!, '_blank'); }}>열기</button>
                            )}
                          </div>
                        </td>
                      );
                    };

                    // Needs review count for the notice bar
                    const needsReviewCount = parts.filter(p => {
                      const pa = campAssets.filter(a => a.participant_id === p.id);
                      return (['proposal', 'rough_cut', 'final_upload'] as SubmissionStage[]).some(s => getSubmissionDisplayStatus(pa, s).status === 'received');
                    }).length;

                    return (
                      <>
                        {needsReviewCount > 0 && (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                            <span style={{ fontSize: 13, color: '#A8712A', fontWeight: 500 }}>확인 필요 {needsReviewCount}건</span>
                            <button style={btnGhost} onClick={() => openAddParticipant(c.id)}>+ 참여자 추가</button>
                          </div>
                        )}
                        {needsReviewCount === 0 && (
                          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                            <button style={btnGhost} onClick={() => openAddParticipant(c.id)}>+ 참여자 추가</button>
                          </div>
                        )}

                        {parts.length === 0 ? (
                          <p style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>참여자가 없습니다</p>
                        ) : (
                          <div style={{ overflowX: 'auto' }}>
                            <table className="data-table" style={{ width: '100%', fontSize: 13, tableLayout: 'fixed' }}>
                              <colgroup>
                                {(() => {
                                  // Calculate column count and widths dynamically
                                  const cols = 2 + (showProposal ? 1 : 0) + (showRoughCut ? 1 : 0) + 1 + (showSettlement ? 1 : 0); // name + consent + proposal? + roughcut? + upload + settlement?
                                  const menuW = 36; // px for ⋯ column
                                  // Distribute remaining width proportionally
                                  const nameW = '18%';
                                  const consentW = '8%';
                                  const stageW = showSettlement ? '16%' : '20%';
                                  const settlW = '10%';
                                  return (
                                    <>
                                      <col style={{ width: nameW }} />
                                      <col style={{ width: consentW }} />
                                      {showProposal && <col style={{ width: stageW }} />}
                                      {showRoughCut && <col style={{ width: stageW }} />}
                                      <col style={{ width: stageW }} />
                                      {showSettlement && <col style={{ width: settlW }} />}
                                      <col style={{ width: menuW }} />
                                    </>
                                  );
                                })()}
                              </colgroup>
                              <thead>
                                <tr>
                                  <th style={{ textAlign: 'left', paddingLeft: 6 }}>인플루언서</th>
                                  <th style={{ textAlign: 'center' }}>동의서</th>
                                  {showProposal && <th style={{ textAlign: 'center' }}>기획안</th>}
                                  {showRoughCut && <th style={{ textAlign: 'center' }}>가편집본</th>}
                                  <th style={{ textAlign: 'center' }}>{isFreeSeed ? '업로드 (선택)' : '업로드'}</th>
                                  {showSettlement && <th style={{ textAlign: 'center' }}>정산</th>}
                                  <th></th>
                                </tr>
                              </thead>
                              <tbody>
                                {sorted.map((p) => {
                                  const pName = p.name || p.display_name || '(채널명 미입력)';
                                  const hasFee = isPaidCollab(p.collab_type) || (p.fee || 0) > 0;

                                  // Consent cell content
                                  const consentLabel = p.consent_status === 'agreed'
                                    ? <span style={{ color: '#22C55E', fontWeight: 500 }}>✓</span>
                                    : p.consent_status === 'sent'
                                    ? <span style={{ fontSize: 11, color: '#A8712A' }}>발송</span>
                                    : p.consent_status === 'expired'
                                    ? <span style={{ fontSize: 11, color: '#B03F3B' }}>만료</span>
                                    : <span style={{ fontSize: 11, color: '#C4CAD1' }}>—</span>;
                                  const consentCell = (
                                    <>
                                      {consentLabel}
                                      <div className="ua" style={{ display: 'none', position: 'absolute', top: 2, right: 2, gap: 3, zIndex: 5 }}>
                                        {p.consent_token ? (
                                          <>
                                            <button style={{ padding: '2px 6px', fontSize: 10, borderRadius: 4, border: 'none', background: '#1A1D21', color: '#fff', cursor: 'pointer' }}
                                              onClick={(e) => { e.stopPropagation(); copyToClipboard(getLinkUrl(p.consent_token!, 'consent')); }}>복사</button>
                                            <button style={{ padding: '2px 6px', fontSize: 10, borderRadius: 4, border: '1px solid var(--border)', background: '#fff', cursor: 'pointer' }}
                                              onClick={(e) => { e.stopPropagation(); window.open(getLinkUrl(p.consent_token!, 'consent'), '_blank'); }}>열기</button>
                                          </>
                                        ) : p.consent_status !== 'agreed' ? (
                                          <button style={{ padding: '2px 6px', fontSize: 10, borderRadius: 4, border: 'none', background: '#1A1D21', color: '#fff', cursor: 'pointer' }}
                                            onClick={(e) => { e.stopPropagation(); handleUpdateParticipant(p.id, { generate_consent_token: true }); }}>발송</button>
                                        ) : null}
                                      </div>
                                    </>
                                  );

                                  // Settlement cell
                                  const settlementLabel = (() => {
                                    if (!showSettlement) return null;
                                    if (p.settlement_status === 'paid') return <span style={{ color: '#22C55E', fontWeight: 500, fontSize: 12 }}>✓ 완료</span>;
                                    if (p.settlement_status === 'docs_submitted' || p.settlement_status === 'payment_requested') return <span style={{ fontSize: 11, color: '#A8712A' }}>지급 대기</span>;
                                    if (p.settlement_status === 'docs_requested') return <span style={{ fontSize: 11, color: '#9AA2AA' }}>정보 대기</span>;
                                    if (!p.published_url) return <span style={{ fontSize: 11, color: '#C4CAD1' }}>—</span>;
                                    return <span style={{ fontSize: 11, color: '#9AA2AA' }}>대기</span>;
                                  })();
                                  const settlementCell = showSettlement ? (
                                    <>
                                      {settlementLabel}
                                      <div className="ua" style={{ display: 'none', position: 'absolute', top: 2, right: 2, gap: 3, zIndex: 5 }}>
                                        {p.settlement_token ? (
                                          <>
                                            <button style={{ padding: '2px 6px', fontSize: 10, borderRadius: 4, border: 'none', background: '#1A1D21', color: '#fff', cursor: 'pointer' }}
                                              onClick={(e) => { e.stopPropagation(); copyToClipboard(getLinkUrl(p.settlement_token!, 'settlement')); }}>복사</button>
                                            <button style={{ padding: '2px 6px', fontSize: 10, borderRadius: 4, border: '1px solid var(--border)', background: '#fff', cursor: 'pointer' }}
                                              onClick={(e) => { e.stopPropagation(); window.open(getLinkUrl(p.settlement_token!, 'settlement'), '_blank'); }}>열기</button>
                                          </>
                                        ) : p.published_url && p.settlement_status !== 'paid' && p.settlement_status !== 'docs_submitted' && p.settlement_status !== 'payment_requested' ? (
                                          <button style={{ padding: '2px 6px', fontSize: 10, borderRadius: 4, border: 'none', background: '#1A1D21', color: '#fff', cursor: 'pointer' }}
                                            onClick={(e) => { e.stopPropagation(); handleUpdateParticipant(p.id, { generate_settlement_token: true }); }}>발급</button>
                                        ) : null}
                                      </div>
                                    </>
                                  ) : null;

                                  return (
                                    <tr key={p.id}>
                                      {/* 인플루언서 + 고료 */}
                                      <td style={{ verticalAlign: 'middle', padding: '8px 6px' }}>
                                        <div style={{ fontWeight: 500, color: pName !== '(채널명 미입력)' ? '#1A1D21' : '#9AA2AA', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                                          onClick={() => { setDetailPart(p); setDetailCampaign(c); }}>
                                          {pName}
                                          {p.memo && <MemoIcon hasMemo size={10} />}
                                        </div>
                                        {hasFee && <div style={{ fontSize: 11, color: '#9AA2AA', marginTop: 1 }}>{fmtKRW(p.fee)}</div>}
                                        {!hasFee && p.handle && <div style={{ fontSize: 11, color: '#9AA2AA', marginTop: 1 }}>@{p.handle}</div>}
                                      </td>
                                      {/* 동의서 */}
                                      <td className="uc" style={{ textAlign: 'center', verticalAlign: 'middle', padding: '8px 6px', position: 'relative' }}>{consentCell}</td>
                                      {/* 기획안 */}
                                      {showProposal && renderSubCell(p.id, 'proposal', pName)}
                                      {/* 가편집본 */}
                                      {showRoughCut && renderSubCell(p.id, 'rough_cut', pName)}
                                      {/* 업로드 */}
                                      {renderSubCell(p.id, 'final_upload', pName)}
                                      {/* 정산 */}
                                      {showSettlement && <td className="uc" style={{ textAlign: 'center', verticalAlign: 'middle', padding: '8px 6px', position: 'relative' }}>{settlementCell}</td>}
                                      {/* ⋯ menu */}
                                      <td style={{ textAlign: 'center', position: 'relative', verticalAlign: 'middle', padding: '8px 2px' }}>
                                        <div style={{ position: 'relative', display: 'inline-block' }}>
                                          <EllipsisBtn onClick={(e) => { e.stopPropagation(); setPartMenuId(partMenuId === p.id ? null : p.id); }} />
                                          {partMenuId === p.id && (
                                            <EllipsisMenu
                                              menuRef={partMenuRef}
                                              items={[
                                                { label: '참여자 수정', onClick: () => openEditParticipant(p) },
                                                { label: '업로드 정보 수정', onClick: () => openUploadModal(p) },
                                                ...(p.consent_token ? [{ label: '동의서 열기', onClick: () => { window.open(getLinkUrl(p.consent_token!, 'consent'), '_blank'); setPartMenuId(null); } }] : []),
                                                { label: '모든 진행 기록 초기화', onClick: () => { setResetModal({ type: 'participant', id: p.id, name: (p.display_name || p.name || p.channel || ''), confirmName: (p.channel || p.display_name || p.name || '') }); setResetConfirmInput(''); setResetError(''); setPartMenuId(null); } },
                                                { label: '삭제', onClick: () => openDeleteParticipant(p), danger: true },
                                              ]}
                                            />
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
                    );
                  })()}
                  </>
                </div>
              )}
            </div>
          );
        })}

        {!loading && campaigns.length === 0 && (
          <div style={{ ...sectionStyle, textAlign: 'center', padding: '60px 24px' }}>
            <p style={{ fontSize: 16, color: 'var(--text-secondary)', marginBottom: 8 }}>등록된 캠페인이 없습니다</p>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>상단의 &quot;+ 캠페인 생성&quot; 버튼으로 시작하세요</p>
          </div>
        )}

        {/* Campaign Create/Edit Modal */}
        {showCampaignModal && (
          <div style={modalOverlay} onMouseDown={(e) => { mouseDownRef.current = e.target; }} onClick={(e) => { if (e.target === e.currentTarget && mouseDownRef.current === e.currentTarget) setShowCampaignModal(false); }}>
            <div style={modalContent}>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20 }}>{editCampaignId ? '캠페인 수정' : '캠페인 생성'}</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={labelStyle}>캠페인 이름 *</label>
                  <input style={inputStyle} value={campaignForm.name} onChange={(e) => setCampaignForm({ ...campaignForm, name: e.target.value })} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={labelStyle}>월</label>
                    <input type="month" style={inputStyle} value={campaignForm.month} onChange={(e) => setCampaignForm({ ...campaignForm, month: e.target.value })} />
                  </div>
                  <div>
                    <label style={labelStyle}>상태</label>
                    <select style={inputStyle} value={campaignForm.status} onChange={(e) => setCampaignForm({ ...campaignForm, status: e.target.value as CampaignStatus })}>
                      {(Object.entries(CAMPAIGN_STATUS_LABELS) as [CampaignStatus, string][]).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>예산 (원)</label>
                  <input type="number" style={inputStyle} value={campaignForm.budget} onChange={(e) => setCampaignForm({ ...campaignForm, budget: parseInt(e.target.value) || 0 })} />
                </div>
                <div>
                  <label style={labelStyle}>메모</label>
                  <textarea style={{ ...inputStyle, minHeight: 60 }} value={campaignForm.memo} onChange={(e) => setCampaignForm({ ...campaignForm, memo: e.target.value })} />
                </div>
              </div>
              {campaignError && (
                <div style={{ marginTop: 12, padding: '8px 12px', background: '#FBE9E8', borderRadius: 6, fontSize: 13, color: '#8F3A37' }}>
                  {campaignError}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
                <button style={btnGhost} onClick={() => { setShowCampaignModal(false); setCampaignError(''); }} disabled={campaignSaving}>취소</button>
                <button style={btnPrimary} onClick={handleSaveCampaign} disabled={!campaignForm.name.trim() || campaignSaving}>
                  {campaignSaving ? '저장 중...' : (editCampaignId ? '저장' : '생성')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Add/Edit Participant Modal */}
        {showPartModal && (
          <div style={modalOverlay} onMouseDown={(e) => { mouseDownRef.current = e.target; }} onClick={(e) => { if (e.target === e.currentTarget && mouseDownRef.current === e.currentTarget) setShowPartModal(false); }}>
            <div style={modalContent}>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20 }}>{editPartId ? '참여자 수정' : '참여자 추가'}</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={labelStyle}>이름 * <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>채널명 입력</span></label>
                  <input style={inputStyle} value={partForm.name} onChange={(e) => setPartForm({ ...partForm, name: e.target.value })} />
                </div>
                <div>
                  <label style={labelStyle}>표시명</label>
                  <input style={inputStyle} value={partForm.display_name} onChange={(e) => setPartForm({ ...partForm, display_name: e.target.value })} placeholder="동의서/정산서에 표시될 이름" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={labelStyle}>채널</label>
                    <select style={inputStyle} value={partForm.channel} onChange={(e) => setPartForm({ ...partForm, channel: e.target.value })}>
                      <option value="">선택</option>
                      {(Object.entries(CHANNEL_LABELS) as [Channel, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>프로필 URL</label>
                    <input style={inputStyle} value={partForm.profile_url} onChange={(e) => setPartForm({ ...partForm, profile_url: e.target.value })} placeholder="https://..." />
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>협업 유형 *</label>
                  <select style={inputStyle} value={partForm.collab_type} onChange={(e) => setPartForm({ ...partForm, collab_type: e.target.value as CollabType })}>
                    {(Object.entries(COLLAB_TYPE_LABELS) as [CollabType, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                {isPaidCollab(partForm.collab_type) && (
                  <div style={{ display: 'grid', gridTemplateColumns: partForm.collab_type === 'fixed_fee_rs' ? '1fr 1fr' : '1fr', gap: 12 }}>
                    <div>
                      <label style={labelStyle}>고료 (원)</label>
                      <input type="number" style={inputStyle} value={partForm.fee} onChange={(e) => setPartForm({ ...partForm, fee: parseInt(e.target.value) || 0 })} />
                    </div>
                    {partForm.collab_type === 'fixed_fee_rs' && (
                      <div>
                        <label style={labelStyle}>RS 비율 (%)</label>
                        <input type="number" step="0.1" style={inputStyle} value={partForm.rs_ratio} onChange={(e) => setPartForm({ ...partForm, rs_ratio: e.target.value })} placeholder="예: 10" />
                        <div style={hintStyle}>매출 대비 추가 지급 비율</div>
                      </div>
                    )}
                  </div>
                )}
                <div>
                  <label style={labelStyle}>제공 제품</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {[...settingsSets.map((s) => s.name), ...settingsProducts.map((p) => p.name)].filter((n) => n.trim()).map((name) => {
                      const active = partForm.product_set_name === name;
                      return (
                        <button key={name} style={chipStyle(active)} onClick={() => setPartForm({ ...partForm, product_set_name: active ? '' : name })}>{name}</button>
                      );
                    })}
                  </div>
                  {settingsProducts.length === 0 && settingsSets.length === 0 && <p style={hintStyle}>설정 &gt; 제품 관리에서 제품을 먼저 등록하세요</p>}
                </div>
                <div>
                  <label style={labelStyle}>콘텐츠 형식</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {(Object.entries(CONTENT_FORMAT_LABELS) as [ContentFormat, string][]).map(([k, v]) => (
                      <button key={k} style={chipStyle(partForm.content_formats.some((f) => f.format === k))} onClick={() => toggleContentFormat(k)}>{v}</button>
                    ))}
                  </div>
                  {partForm.content_formats.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {partForm.content_formats.map((cf, i) => (
                        <div key={cf.format} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                          <span style={{ color: 'var(--text-secondary)' }}>{CONTENT_FORMAT_LABELS[cf.format]}</span>
                          <input type="number" min={1} style={{ ...inputStyle, width: 50, padding: '4px 6px', textAlign: 'center' }} value={cf.count} onChange={(e) => {
                            const next = [...partForm.content_formats];
                            next[i] = { ...next[i], count: parseInt(e.target.value) || 1 };
                            setPartForm({ ...partForm, content_formats: next });
                          }} />
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>건</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" id="secondary_use" checked={partForm.secondary_use} onChange={(e) => setPartForm({ ...partForm, secondary_use: e.target.checked })} />
                  <label htmlFor="secondary_use" style={{ fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>2차 활용</label>
                </div>
                {partForm.secondary_use && (
                  <div>
                    <label style={labelStyle}>활용 기간</label>
                    <input style={inputStyle} value={partForm.secondary_use_period} onChange={(e) => setPartForm({ ...partForm, secondary_use_period: e.target.value })} placeholder="예: 1개월, 3개월" />
                  </div>
                )}
                <div>
                  <label style={labelStyle}>메모</label>
                  <textarea style={{ ...inputStyle, minHeight: 60 }} value={partForm.memo} onChange={(e) => setPartForm({ ...partForm, memo: e.target.value })} />
                </div>
              </div>
              {partError && (
                <div style={{ marginTop: 12, padding: '8px 12px', background: '#FBE9E8', borderRadius: 6, fontSize: 13, color: '#8F3A37' }}>
                  {partError}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
                <button style={btnGhost} onClick={() => { setShowPartModal(false); setPartError(''); }} disabled={partSaving}>취소</button>
                <button style={btnPrimary} onClick={handleSaveParticipant} disabled={!partForm.name.trim() || partSaving}>
                  {partSaving ? '저장 중...' : (editPartId ? '저장' : '추가')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Detail Panel (480px right slide) */}
        {detailPart && (
          <>
            <div
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.2)', zIndex: 200 }}
              onClick={() => { setDetailPart(null); setDetailCampaign(null); }}
            />
            <div style={{
              position: 'fixed', top: 0, right: 0, bottom: 0, width: 480, background: 'var(--surface)',
              boxShadow: '-4px 0 24px rgba(0,0,0,0.08)', zIndex: 201, overflowY: 'auto', padding: '24px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{detailPart.name || detailPart.display_name || '(채널명 미입력)'}</h2>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    {[detailPart.handle ? `@${detailPart.handle}` : null, detailPart.channel ? CHANNEL_LABELS[detailPart.channel] : null].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={btnSmall} onClick={() => { setDetailPart(null); openEditParticipant(detailPart); }}>수정</button>
                  <button style={{ ...btnGhost, padding: '4px 8px' }} onClick={() => { setDetailPart(null); setDetailCampaign(null); }}>&#10005;</button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', fontSize: 13, marginBottom: 20 }}>
                <div><span style={{ color: 'var(--text-info)' }}>채널:</span> {detailPart.channel ? CHANNEL_LABELS[detailPart.channel] : '-'}</div>
                <div><span style={{ color: 'var(--text-info)' }}>협업유형:</span> {(() => { const ct = detailPart.collab_type || detailCampaign?.collab_type || ((detailPart.fee || 0) > 0 ? 'fixed_fee' : 'free_seeding'); return COLLAB_TYPE_LABELS[ct as CollabType] || '-'; })()}</div>
                <div><span style={{ color: 'var(--text-info)' }}>프로필:</span> {detailPart.profile_url ? <a href={detailPart.profile_url} target="_blank" rel="noopener noreferrer" style={{ color: '#4A7DB5' }}>링크</a> : '-'}</div>
                <div><span style={{ color: 'var(--text-info)' }}>제공제품:</span> {detailPart.product_set_name || detailPart.product || '-'}</div>
                <div><span style={{ color: 'var(--text-info)' }}>콘텐츠:</span> {formatContentFormats(detailPart.content_formats ?? []) || (detailPart.post_type ? `${CONTENT_FORMAT_LABELS[detailPart.post_type as ContentFormat] ?? detailPart.post_type} ${detailPart.post_count ?? 1}건` : '-')}</div>
                <div><span style={{ color: 'var(--text-info)' }}>고료:</span> {fmtKRW(detailPart.fee)}</div>
                <div><span style={{ color: 'var(--text-info)' }}>2차 활용:</span> {detailPart.secondary_use ? `예 (${detailPart.secondary_use_period || '-'})` : '아니오'}</div>
                {detailPart.rs_ratio != null && <div><span style={{ color: 'var(--text-info)' }}>RS 비율:</span> {detailPart.rs_ratio}%</div>}
                <div><span style={{ color: 'var(--text-info)' }}>연락처:</span> {detailPart.phone || '-'}</div>
                <div style={{ gridColumn: '1 / -1' }}><span style={{ color: 'var(--text-info)' }}>메모:</span> {detailPart.memo || '-'}</div>
              </div>
              {(detailPart.delivery_name || detailPart.delivery_phone || detailPart.delivery_address || detailPart.delivery_address_base) && (
                <div style={{ marginBottom: 16, padding: '12px', background: '#F2F4F7', borderRadius: 8, fontSize: 13 }}>
                  <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>배송 정보</div>
                  <div><span style={{ color: 'var(--text-info)' }}>수령인:</span> {detailPart.delivery_name || '-'}</div>
                  <div><span style={{ color: 'var(--text-info)' }}>연락처:</span> {detailPart.delivery_phone || '-'}</div>
                  <div><span style={{ color: 'var(--text-info)' }}>주소:</span> {detailPart.delivery_address || [detailPart.delivery_postal_code, detailPart.delivery_address_base, detailPart.delivery_address_detail].filter(Boolean).join(' ') || '-'}</div>
                </div>
              )}
              {/* ── 일정 섹션 ── */}
              {(() => {
                const ct = detailPart.collab_type || detailCampaign?.collab_type || ((detailPart.fee || 0) > 0 ? 'fixed_fee' : 'free_seeding');
                const paid = isPaidCollab(ct);
                const hasDates = paid
                  ? (detailPart.planned_draft_date || detailPart.planned_edit_date || detailPart.planned_upload_date)
                  : detailPart.planned_upload_date;
                if (!hasDates) return null;

                const cDraft = detailPart.confirmed_draft_date;
                const cEdit = detailPart.confirmed_edit_date;
                const cUpload = detailPart.confirmed_upload_date;
                const pDraft = detailPart.planned_draft_date;
                const pEdit = detailPart.planned_edit_date;
                const pUpload = detailPart.planned_upload_date;

                const hasProposed = paid ? (pDraft || pEdit || pUpload) : pUpload;
                const hasConfirmed = paid ? (cDraft || cEdit || cUpload) : cUpload;
                const canConfirm = hasProposed && !hasConfirmed;

                const handleConfirmDates = async () => {
                  const updates: Record<string, unknown> = {};
                  if (paid && pDraft) updates.confirmed_draft_date = pDraft;
                  if (paid && pEdit) updates.confirmed_edit_date = pEdit;
                  if (pUpload) updates.confirmed_upload_date = pUpload;
                  // Date order validation
                  const dates = [updates.confirmed_draft_date, updates.confirmed_edit_date, updates.confirmed_upload_date].filter(Boolean) as string[];
                  for (let i = 1; i < dates.length; i++) {
                    if (dates[i] < dates[i - 1]) {
                      alert('일정 순서가 올바르지 않습니다. (기획안 ≤ 가편집본 ≤ 업로드)');
                      return;
                    }
                  }
                  await handleUpdateParticipant(detailPart.id, updates);
                };

                const dateLabel = (confirmed: string | null, proposed: string | null) => {
                  if (confirmed) return <span style={{ color: 'var(--text-primary)' }}>{confirmed}</span>;
                  if (proposed) return <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{proposed} <span style={{ fontSize: 11 }}>(미확정)</span></span>;
                  return <span style={{ color: 'var(--text-muted)' }}>-</span>;
                };

                return (
                  <div style={{ marginBottom: 16, fontSize: 13 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>일정</span>
                      {canConfirm && (
                        <button onClick={handleConfirmDates} style={{ fontSize: 11, padding: '2px 8px', border: '1px solid var(--accent)', borderRadius: 6, background: 'var(--accent-light)', color: 'var(--accent)', cursor: 'pointer', fontFamily: 'var(--font)', fontWeight: 500 }}>
                          일정 확정
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: paid ? '1fr 1fr 1fr' : '1fr', gap: 8 }}>
                      {paid && <div><span style={{ color: 'var(--text-info)' }}>기획안:</span> {dateLabel(cDraft, pDraft)}</div>}
                      {paid && <div><span style={{ color: 'var(--text-info)' }}>가편집본:</span> {dateLabel(cEdit, pEdit)}</div>}
                      <div><span style={{ color: 'var(--text-info)' }}>업로드:</span> {dateLabel(cUpload, pUpload)}</div>
                    </div>
                  </div>
                );
              })()}
              {/* ── 진행 ── */}
              {(() => {
                const ct = detailPart.collab_type || detailCampaign?.collab_type || ((detailPart.fee || 0) > 0 ? 'fixed_fee' : 'free_seeding');
                const paid = isPaidCollab(ct);
                const pAssets = detailCampaign ? (submissionAssets[detailCampaign.id] || []).filter(a => a.participant_id === detailPart.id) : [];

                type StepDef = {
                  key: string; stage: SubmissionStage | 'consent' | 'payment'; label: string;
                  isApproved: boolean; hasData: boolean; disabled?: boolean; dateLabel?: string;
                  asset?: SubmissionAsset; allVersions?: SubmissionAsset[];
                };
                const steps: StepDef[] = [];

                // Consent
                steps.push({
                  key: 'consent', stage: 'consent', label: '동의서',
                  isApproved: !!detailPart.consent_agreed_at,
                  hasData: !!detailPart.consent_agreed_at,
                  disabled: true,
                  dateLabel: detailPart.consent_agreed_at
                    ? `회수 ${new Date(detailPart.consent_agreed_at).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })}`
                    : undefined,
                });

                // Proposal / Rough cut (only for paid collabs, i.e. not free_seeding)
                const stageMap: { stage: SubmissionStage; label: string; paidOnly: boolean }[] = [
                  { stage: 'proposal', label: '기획안', paidOnly: true },
                  { stage: 'rough_cut', label: '가편집본', paidOnly: true },
                  { stage: 'final_upload', label: '최종 업로드', paidOnly: false },
                ];

                for (const sm of stageMap) {
                  if (sm.paidOnly && ct === 'free_seeding') continue;
                  const stageAssets = pAssets.filter(a => a.stage === sm.stage).sort((a, b) => b.version - a.version);
                  const latest = stageAssets[0];
                  const ds = getSubmissionDisplayStatus(pAssets, sm.stage);
                  steps.push({
                    key: sm.stage, stage: sm.stage, label: sm.label,
                    isApproved: ds.status === 'approved',
                    hasData: !!latest,
                    asset: latest,
                    allVersions: stageAssets,
                    dateLabel: ds.status === 'approved' && latest?.reviews?.[0]?.created_at
                      ? `확인 ${new Date(latest.reviews[0].created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })}`
                      : ds.status === 'received' && latest?.received_at
                        ? `수령 ${new Date(latest.received_at).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })}`
                        : ds.status === 'revision_requested'
                          ? `수정 요청 ${ds.daysSinceRevision ?? 0}일`
                          : undefined,
                  });
                }

                // Payment
                if (paid) {
                  const isPaid = detailPart.settlement_status === 'paid';
                  steps.push({
                    key: 'payment', stage: 'payment', label: '지급',
                    isApproved: isPaid, hasData: isPaid, disabled: true,
                    dateLabel: isPaid ? '완료' : undefined,
                  });
                }

                return (
                  <div style={{ marginBottom: 16, fontSize: 13 }}>
                    <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>진행</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {steps.map((s) => {
                        const isSubmissionStage = s.stage === 'proposal' || s.stage === 'rough_cut' || s.stage === 'final_upload';
                        const ds = isSubmissionStage ? getSubmissionDisplayStatus(pAssets, s.stage as SubmissionStage) : null;
                        const oldStepMap: Record<string, string> = { proposal: 'draft', rough_cut: 'edit', final_upload: 'upload' };
                        const oldStep = oldStepMap[s.stage] || s.stage;
                        return (
                          <div key={s.key}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 26 }}>
                              <input
                                type="checkbox"
                                checked={s.isApproved}
                                disabled={s.disabled}
                                onChange={() => {
                                  if (s.disabled) return;
                                  if (!isSubmissionStage) return;
                                  if (s.isApproved && s.asset) {
                                    // Undo approved: use old check-step undo
                                    if (oldStep === 'upload') {
                                      if (detailPart.settlement_status === 'paid') {
                                        setErrorMsg('지급 완료 상태에서는 업로드를 취소할 수 없습니다');
                                        setTimeout(() => setErrorMsg(''), 4000);
                                        return;
                                      }
                                    }
                                    setUndoConfirmModal({ participantId: detailPart.id, step: oldStep, stepLabel: s.label });
                                    setUndoConfirmError('');
                                  } else if (!s.hasData) {
                                    // Open receive modal
                                    const kst = new Date(Date.now() + 9 * 3600000);
                                    const today = kst.toISOString().slice(0, 10);
                                    setEditStepModal({
                                      participantId: detailPart.id,
                                      step: oldStep,
                                      stepLabel: s.label,
                                      link: '',
                                      receivedDate: today,
                                      memo: '',
                                      processType: 'approved',
                                      revisionNote: '',
                                      reviewCategory: '',
                                      noLink: false,
                                      fileUrl: '',
                                      originalFilename: '',
                                      mimeType: '',
                                      fileSize: 0,
                                      contentType: '',
                                    });
                                    setEditStepError('');
                                  } else if (s.hasData && !s.isApproved && s.asset) {
                                    // Has data but not approved → approve inline
                                    handleApproveAsset(s.asset.id);
                                  }
                                }}
                                style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: s.disabled ? 'default' : 'pointer' }}
                              />
                              <span style={{ color: s.isApproved ? 'var(--text-secondary)' : s.hasData ? 'var(--text-secondary)' : 'var(--text-muted)', flex: 1 }}>
                                {s.label}
                                {s.dateLabel && (
                                  <span style={{ fontSize: 11, color: ds?.status === 'revision_requested' ? '#B03F3B' : 'var(--text-info)', marginLeft: 6 }}>{s.dateLabel}</span>
                                )}
                              </span>
                              {isSubmissionStage && s.hasData && ds?.status === 'received' && s.asset && (
                                <button
                                  onClick={() => handleApproveAsset(s.asset!.id)}
                                  style={{ fontSize: 11, padding: '1px 8px', border: 'none', borderRadius: 4, background: '#1A1D21', color: '#fff', cursor: 'pointer', fontFamily: 'var(--font)', flexShrink: 0 }}
                                >확인 완료</button>
                              )}
                            </div>
                            {/* Asset link */}
                            {s.asset?.external_url && (
                              <div style={{ marginLeft: 20, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <a href={s.asset.external_url} target="_blank" rel="noopener noreferrer"
                                  style={{ fontSize: 12, color: '#4A7DB5', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>
                                  {s.asset.external_url}
                                </a>
                                <button onClick={() => copyToClipboard(s.asset!.external_url!)}
                                  style={{ fontSize: 11, padding: '1px 6px', border: '1px solid var(--border)', borderRadius: 4, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font)', flexShrink: 0 }}>복사</button>
                                <a href={s.asset.external_url} target="_blank" rel="noopener noreferrer"
                                  style={{ fontSize: 11, padding: '1px 6px', border: '1px solid var(--border)', borderRadius: 4, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font)', textDecoration: 'none', flexShrink: 0 }}>열기</a>
                              </div>
                            )}
                            {/* Asset file */}
                            {s.asset?.file_path && (
                              <div style={{ marginLeft: 20, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                  {s.asset.original_filename || '파일'}
                                </span>
                                {s.asset.file_size && (
                                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({formatFileSize(s.asset.file_size)})</span>
                                )}
                                <button onClick={async () => {
                                  const res = await fetch(`/api/influencer/files/signed-url?path=${encodeURIComponent(s.asset!.file_path!)}`);
                                  const data = await res.json();
                                  if (data.url) window.open(data.url, '_blank');
                                }} style={{ fontSize: 11, padding: '1px 6px', border: '1px solid var(--border)', borderRadius: 4, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font)', flexShrink: 0 }}>열기</button>
                                <button onClick={async () => {
                                  const res = await fetch(`/api/influencer/files/signed-url?path=${encodeURIComponent(s.asset!.file_path!)}`);
                                  const data = await res.json();
                                  if (data.url) { const a = document.createElement('a'); a.href = data.url; a.download = s.asset!.original_filename || 'download'; a.click(); }
                                }} style={{ fontSize: 11, padding: '1px 6px', border: '1px solid var(--border)', borderRadius: 4, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font)', flexShrink: 0 }}>다운로드</button>
                              </div>
                            )}
                            {/* Status label */}
                            {ds && ds.status !== 'approved' && ds.status !== 'not_received' && (
                              <div style={{ marginLeft: 20, marginTop: 2, fontSize: 12, color: ds.status === 'revision_requested' ? '#B03F3B' : 'var(--text-muted)' }}>
                                {SUBMISSION_STATUS_LABELS[ds.status]}
                                {s.asset?.reviews?.[0]?.reason && ` · ${s.asset.reviews[0].reason}`}
                              </div>
                            )}
                            {/* Content type */}
                            {s.asset?.content_type && (
                              <div style={{ marginLeft: 20, marginTop: 2, fontSize: 12, color: 'var(--text-muted)' }}>
                                유형: {FINAL_CONTENT_TYPES[s.asset.content_type] || s.asset.content_type}
                              </div>
                            )}
                            {/* Review memo */}
                            {s.asset?.reviews?.[0]?.memo && (
                              <div style={{ marginLeft: 20, marginTop: 2, fontSize: 12, color: 'var(--text-muted)' }}>
                                메모: {s.asset.reviews[0].memo}
                              </div>
                            )}
                            {/* Version history */}
                            {s.allVersions && s.allVersions.length > 1 && (
                              <div style={{ marginLeft: 20, marginTop: 4 }}>
                                <details>
                                  <summary style={{ fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>
                                    이전 버전 ({s.allVersions.length - 1}건)
                                  </summary>
                                  {s.allVersions.slice(1).map((v) => (
                                    <div key={v.id} style={{ marginTop: 4, padding: '4px 8px', background: '#F2F4F7', borderRadius: 4, fontSize: 11 }}>
                                      <span style={{ color: 'var(--text-muted)' }}>v{v.version}</span>
                                      <span style={{ marginLeft: 6, color: v.status === 'revision_requested' ? '#B03F3B' : 'var(--text-secondary)' }}>
                                        {SUBMISSION_STATUS_LABELS[v.status] || v.status}
                                      </span>
                                      {v.reviews?.[0]?.reason && <span style={{ marginLeft: 4, color: '#B03F3B' }}>{'\u00B7'} {v.reviews[0].reason}</span>}
                                      {v.original_filename && <span style={{ marginLeft: 6, color: 'var(--text-muted)' }}>{v.original_filename}</span>}
                                      {v.external_url && <span style={{ marginLeft: 6, color: 'var(--text-muted)' }}>{v.external_url.slice(0, 40)}...</span>}
                                    </div>
                                  ))}
                                </details>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginBottom: 16 }}></div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>상태 변경</label>
                <CustomSelect
                  value={detailPart.status}
                  onChange={(v) => handleUpdateParticipant(detailPart.id, { status: v })}
                  options={Object.entries(PARTICIPANT_STATUS_LABELS).map(([k, v]) => ({ value: k, label: v }))}
                  size="md"
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>게시 URL</label>
                <input style={inputStyle} defaultValue={detailPart.published_url || ''} onBlur={(e) => {
                  if (e.target.value !== (detailPart.published_url || '')) handleUpdateParticipant(detailPart.id, { published_url: e.target.value || null });
                }} placeholder="https://..." />
              </div>
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginBottom: 16 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>동의서</h3>
                <div style={{ display: 'flex', gap: 16, fontSize: 13, marginBottom: 12 }}>
                  <div><span style={{ color: 'var(--text-info)' }}>상태:</span> {detailPart.consent_status === 'not_sent' ? '미발송' : detailPart.consent_status === 'sent' ? '발송됨' : detailPart.consent_status === 'agreed' ? '회수완료' : '만료'}</div>
                  {detailPart.consent_agreed_at && <div><span style={{ color: 'var(--text-info)' }}>동의일:</span> {new Date(detailPart.consent_agreed_at).toLocaleDateString('ko-KR')}</div>}
                </div>
                {detailPart.consent_status === 'agreed' && (
                  <div style={{ background: '#F2F4F7', borderRadius: 8, padding: '10px 12px', fontSize: 12, marginBottom: 12, lineHeight: 1.8 }}>
                    <div style={{ color: '#8E959D' }}>&#10003; 개인정보 수집 및 이용 동의</div>
                    <div style={{ color: '#8E959D' }}>&#10003; 광고 표시 동의</div>
                    <div style={{ color: '#8E959D' }}>&#10003; 진행 조건 동의</div>
                    {detailPart.secondary_use && <div style={{ color: '#8E959D' }}>&#10003; 2차 활용 동의</div>}
                    <a
                      href={`/influencer/consents?open=${detailPart.id}`}
                      style={{ display: 'inline-block', marginTop: 6, fontSize: 12, color: '#4A7DB5', textDecoration: 'none', fontWeight: 500 }}
                    >
                      동의서 전체 보기 &rarr;
                    </a>
                  </div>
                )}
                {detailPart.consent_token ? (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button style={btnSmall} onClick={() => copyToClipboard(getLinkUrl(detailPart.consent_token!, 'consent'))}>복사</button>
                    <button style={{ ...btnSmall, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)' }} onClick={() => window.open(getLinkUrl(detailPart.consent_token!, 'consent'), '_blank')}>열기</button>
                  </div>
                ) : detailPart.consent_status !== 'agreed' ? (
                  <button style={btnGhost} onClick={() => handleUpdateParticipant(detailPart.id, { generate_consent_token: true })}>동의서 링크 생성</button>
                ) : null}
              </div>
              {(isPaidCollab(detailPart.collab_type) || isPaidCollab(detailCampaign?.collab_type)) && (
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>정산</h3>
                  <div style={{ display: 'flex', gap: 16, fontSize: 13, marginBottom: 12 }}>
                    <div><span style={{ color: 'var(--text-info)' }}>상태:</span> {SETTLEMENT_STAGE_LABELS[getSettlementStatus(detailPart)]}</div>
                  </div>
                  {(detailPart.settlement_status === 'docs_submitted' || detailPart.settlement_status === 'payment_requested' || detailPart.settlement_status === 'paid') && (detailPart.bank_name || detailPart.bank_holder) && (
                    <div style={{ background: '#F2F4F7', borderRadius: 8, padding: '10px 12px', fontSize: 12, marginBottom: 12, lineHeight: 1.8 }}>
                      {detailPart.bank_name && <div style={{ color: '#555' }}><span style={{ color: '#8E959D' }}>은행:</span> {detailPart.bank_name}</div>}
                      {detailPart.bank_holder && <div style={{ color: '#555' }}><span style={{ color: '#8E959D' }}>예금주:</span> {detailPart.bank_holder}</div>}
                      {detailPart.business_name && <div style={{ color: '#555' }}><span style={{ color: '#8E959D' }}>사업자명:</span> {detailPart.business_name}</div>}
                    </div>
                  )}
                  <div>
                    {detailPart.settlement_status === 'paid' ? (
                      <>
                        <span style={{ fontSize: 13, color: '#16A34A' }}>지급 완료</span>
                        {detailPart.settlement_token && (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
                            <button style={btnSmall} onClick={() => copyToClipboard(getLinkUrl(detailPart.settlement_token!, 'settlement'))}>링크 복사</button>
                            <button style={{ ...btnSmall, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)' }} onClick={() => window.open(getLinkUrl(detailPart.settlement_token!, 'settlement'), '_blank')}>정산서 보기</button>
                          </div>
                        )}
                      </>
                    ) : detailPart.settlement_status === 'docs_submitted' || detailPart.settlement_status === 'payment_requested' ? (
                      <>
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>정산 정보 회수 완료</span>
                        {detailPart.settlement_token && (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
                            <button style={btnSmall} onClick={() => copyToClipboard(getLinkUrl(detailPart.settlement_token!, 'settlement'))}>링크 복사</button>
                            <button style={{ ...btnSmall, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)' }} onClick={() => window.open(getLinkUrl(detailPart.settlement_token!, 'settlement'), '_blank')}>정산서 보기</button>
                          </div>
                        )}
                      </>
                    ) : detailPart.settlement_token ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button style={btnSmall} onClick={() => copyToClipboard(getLinkUrl(detailPart.settlement_token!, 'settlement'))}>복사</button>
                        <button style={{ ...btnSmall, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)' }} onClick={() => window.open(getLinkUrl(detailPart.settlement_token!, 'settlement'), '_blank')}>열기</button>
                      </div>
                    ) : (
                      <button
                        style={detailPart.published_url ? btnGhost : { ...btnGhost, opacity: 0.4, cursor: 'not-allowed' }}
                        disabled={!detailPart.published_url}
                        title={!detailPart.published_url ? '업로드 확인 후 발급' : undefined}
                        onClick={() => handleUpdateParticipant(detailPart.id, { generate_settlement_token: true })}
                      >정산서 링크 생성</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
        {/* Submit Asset Modal */}
        {submitModal && (
          <div style={modalOverlay} onMouseDown={(e) => { mouseDownRef.current = e.target; }} onClick={(e) => { if (e.target === e.currentTarget && mouseDownRef.current === e.currentTarget) { setSubmitModal(null); } }}>
            <div style={{ ...modalContent, width: 440 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>{submitModal.stageLabel} 등록</h2>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16, marginTop: 0 }}>{submitModal.participantName}</p>
              <div>
                <label style={labelStyle}>링크 *</label>
                <input
                  style={inputStyle}
                  value={submitLink}
                  onChange={(e) => setSubmitLink(e.target.value)}
                  placeholder={submitModal.stage === 'proposal' ? 'https://docs.google.com/...' : submitModal.stage === 'rough_cut' ? 'https://drive.google.com/...' : 'https://instagram.com/reel/...'}
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter' && submitLink.trim()) handleSubmitAsset(); }}
                />
              </div>
              {submitError && (
                <div style={{ marginTop: 12, padding: '8px 12px', background: '#FBE9E8', borderRadius: 6, fontSize: 13, color: '#8F3A37' }}>
                  {submitError}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
                <button style={btnGhost} onClick={() => { setSubmitModal(null); setSubmitLink(''); }} disabled={submitSaving}>취소</button>
                <button style={btnPrimary} onClick={handleSubmitAsset} disabled={!submitLink.trim() || submitSaving}>
                  {submitSaving ? '등록 중...' : '등록'}
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Upload Confirmation Modal */}
        {showUploadModal && (
          <div style={modalOverlay} onMouseDown={(e) => { mouseDownRef.current = e.target; }} onClick={(e) => { if (e.target === e.currentTarget && mouseDownRef.current === e.currentTarget) setShowUploadModal(false); }}>
            <div style={{ ...modalContent, width: 440 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20 }}>업로드 확인</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={labelStyle}>업로드일</label>
                  <DatePicker value={uploadForm.upload_date} onChange={(v) => setUploadForm({ ...uploadForm, upload_date: v })} placeholder="날짜 선택" />
                </div>
                <div>
                  <label style={labelStyle}>콘텐츠 URL *</label>
                  <input style={inputStyle} value={uploadForm.content_url} onChange={(e) => setUploadForm({ ...uploadForm, content_url: e.target.value })} placeholder="https://instagram.com/reel/..." />
                </div>
              </div>
              {uploadError && (
                <div style={{ marginTop: 12, padding: '8px 12px', background: '#FBE9E8', borderRadius: 6, fontSize: 13, color: '#8F3A37' }}>
                  {uploadError}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
                <button style={btnGhost} onClick={() => { setShowUploadModal(false); setUploadError(''); }} disabled={uploadSaving}>취소</button>
                <button style={btnPrimary} onClick={handleUploadConfirm} disabled={!uploadForm.content_url.trim() || uploadSaving}>
                  {uploadSaving ? '저장 중...' : '확인'}
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Delete Confirmation Modal */}
        {deleteModal && (
          <div style={modalOverlay} onMouseDown={(e) => { mouseDownRef.current = e.target; }} onClick={(e) => { if (e.target === e.currentTarget && mouseDownRef.current === e.currentTarget) setDeleteModal(null); }}>
            <div style={{ ...modalContent, width: 420 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
                {deleteModal.type === 'campaign' ? '캠페인 삭제' : '참여자 삭제'}
              </h2>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>
                <strong style={{ color: 'var(--text-primary)' }}>{deleteModal.name}</strong>
                {deleteModal.type === 'campaign' ? '을(를) 삭제합니다.' : '을(를) 삭제합니다.'}
              </div>
              {deleteModal.type === 'campaign' && deleteModal.participantCount > 0 && (
                <div style={{ background: '#F2F4F7', borderRadius: 8, padding: '12px 14px', fontSize: 13, marginBottom: 16, lineHeight: 1.8 }}>
                  <div>참여자 <strong>{deleteModal.participantCount}명</strong> 함께 삭제</div>
                  {deleteModal.consentCount > 0 && <div>동의서 회수 <strong>{deleteModal.consentCount}건</strong></div>}
                </div>
              )}
              {deleteModal.hasSettlement && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ background: '#FCEFEF', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 12, color: '#D9534F' }}>
                    정산 정보가 포함되어 있습니다. {deleteModal.type === 'campaign' ? '캠페인' : '참여자'} 이름을 정확히 입력해주세요.
                  </div>
                  <input
                    style={inputStyle}
                    placeholder={deleteModal.name}
                    value={deleteConfirmName}
                    onChange={(e) => setDeleteConfirmName(e.target.value)}
                    autoFocus
                  />
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
                <button style={btnGhost} onClick={() => setDeleteModal(null)} disabled={deleteLoading}>취소</button>
                <button
                  style={{
                    ...btnPrimary,
                    background: '#D9534F',
                    opacity: (deleteModal.hasSettlement && deleteConfirmName !== deleteModal.name) || deleteLoading ? 0.4 : 1,
                    cursor: (deleteModal.hasSettlement && deleteConfirmName !== deleteModal.name) || deleteLoading ? 'not-allowed' : 'pointer',
                  }}
                  disabled={(deleteModal.hasSettlement && deleteConfirmName !== deleteModal.name) || deleteLoading}
                  onClick={handleDelete}
                >
                  {deleteLoading ? '삭제 중...' : '삭제'}
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Memo popover */}
        {memoTarget && (
          <div style={modalOverlay} onMouseDown={(e) => { mouseDownRef.current = e.target; }} onClick={(e) => { if (e.target === e.currentTarget && mouseDownRef.current === e.currentTarget) setMemoTarget(null); }}>
            <div style={{ ...modalContent, width: 360, padding: '16px 20px' }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>메모</h3>
              <textarea
                style={{ ...inputStyle, minHeight: 80, fontSize: 13 }}
                value={memoText}
                onChange={(e) => setMemoText(e.target.value)}
                placeholder="메모를 입력하세요"
                autoFocus
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <button style={btnGhost} onClick={() => setMemoTarget(null)}>취소</button>
                <button style={btnPrimary} onClick={saveMemo}>저장</button>
              </div>
            </div>
          </div>
        )}
        {/* Hover style for memo icon */}
        <style>{`
          tr:hover .memo-icon-hover { opacity: 1 !important; }
        `}</style>
        {/* Progress Slide Panel */}
        {progressPanel && (() => {
          const pp = progressPanel.participant;
          const panelTitle = progressPanel.type === 'consent' ? '동의서 상세'
            : progressPanel.type === 'upload' ? '업로드 상세' : '정산 상세';
          const rowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' };
          const rlabel: React.CSSProperties = { color: 'var(--text-info)', fontSize: 13 };
          const rvalue: React.CSSProperties = { color: 'var(--text-primary)', fontSize: 13, fontWeight: 500, textAlign: 'right' };

          return (
            <>
              <div
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.2)', zIndex: 200 }}
                onClick={() => setProgressPanel(null)}
              />
              <div style={{
                position: 'fixed', top: 0, right: 0, bottom: 0, width: 420, background: 'var(--surface)',
                boxShadow: '-4px 0 24px rgba(0,0,0,0.08)', zIndex: 201, overflowY: 'auto', padding: '24px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{panelTitle}</h3>
                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-info)' }} onClick={() => setProgressPanel(null)}>&#10005;</button>
                </div>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 16, color: 'var(--text-primary)' }}>
                  {pp.name || pp.display_name || '(채널명 미입력)'}
                  {pp.handle && <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 6 }}>@{pp.handle}</span>}
                </div>

                {progressPanel.type === 'consent' && (
                  <div>
                    <div style={rowStyle}><span style={rlabel}>동의 상태</span><span style={rvalue}>{pp.consent_status === 'agreed' ? '동의 완료' : pp.consent_status === 'sent' ? '발송됨' : '미발송'}</span></div>
                    {pp.consent_agreed_at && <div style={rowStyle}><span style={rlabel}>동의 일시</span><span style={rvalue}>{new Date(pp.consent_agreed_at).toLocaleString('ko-KR')}</span></div>}
                    {pp.consent_ip && <div style={rowStyle}><span style={rlabel}>동의 IP</span><span style={rvalue}>{pp.consent_ip}</span></div>}
                    <div style={rowStyle}><span style={rlabel}>채널</span><span style={rvalue}>{pp.channel ? CHANNEL_LABELS[pp.channel] : '-'}</span></div>
                    <div style={rowStyle}><span style={rlabel}>고료</span><span style={rvalue}>{(pp.fee || 0) > 0 ? fmtKRW(pp.fee) : '무가'}</span></div>
                    {pp.secondary_use && <div style={rowStyle}><span style={rlabel}>2차 활용</span><span style={rvalue}>동의 ({pp.secondary_use_period || '-'})</span></div>}
                    {pp.planned_upload_date && <div style={rowStyle}><span style={rlabel}>업로드 예정일</span><span style={rvalue}>{pp.planned_upload_date}</span></div>}
                    {pp.phone && <div style={rowStyle}><span style={rlabel}>연락처</span><span style={rvalue}>{pp.phone}</span></div>}
                    {(pp.delivery_name || pp.delivery_address) && (
                      <div style={{ marginTop: 16, padding: 12, background: '#F2F4F7', borderRadius: 8, fontSize: 13 }}>
                        <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>배송 정보</div>
                        {pp.delivery_name && <div>수령인: {pp.delivery_name}</div>}
                        {pp.delivery_phone && <div>연락처: {pp.delivery_phone}</div>}
                        {(pp.delivery_address || pp.delivery_address_base) && <div>주소: {pp.delivery_address || [pp.delivery_postal_code, pp.delivery_address_base, pp.delivery_address_detail].filter(Boolean).join(' ')}</div>}
                      </div>
                    )}
                  </div>
                )}

                {progressPanel.type === 'upload' && (
                  <div>
                    <div style={rowStyle}><span style={rlabel}>업로드 상태</span><span style={rvalue}>{pp.published_url ? '완료' : '미완료'}</span></div>
                    {pp.published_url && <div style={rowStyle}><span style={rlabel}>콘텐츠 URL</span><span style={{ ...rvalue, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}><a href={pp.published_url} target="_blank" rel="noopener noreferrer" style={{ color: '#4A7DB5' }}>{pp.published_url}</a></span></div>}
                    {pp.planned_upload_date && <div style={rowStyle}><span style={rlabel}>업로드 예정일</span><span style={rvalue}>{pp.planned_upload_date}</span></div>}
                    {pp.post_type && <div style={rowStyle}><span style={rlabel}>콘텐츠 형식</span><span style={rvalue}>{pp.post_type} {pp.post_count ?? 1}건</span></div>}
                    <div style={rowStyle}><span style={rlabel}>채널</span><span style={rvalue}>{pp.channel ? CHANNEL_LABELS[pp.channel] : '-'}</span></div>
                  </div>
                )}

                {progressPanel.type === 'payment' && (
                  <div>
                    <div style={rowStyle}><span style={rlabel}>정산 상태</span><span style={rvalue}>{SETTLEMENT_STAGE_LABELS[getSettlementStatus(pp)]}</span></div>
                    <div style={rowStyle}><span style={rlabel}>고료 (세전)</span><span style={rvalue}>{fmtKRW(pp.fee)}</span></div>
                    <div style={rowStyle}><span style={rlabel}>정산 정보</span><span style={rvalue}>{pp.settlement_status === 'docs_submitted' ? '회수 완료' : pp.settlement_status === 'docs_requested' ? '발송됨' : '미발송'}</span></div>
                    {pp.settlement_token && pp.settlement_status === 'docs_requested' && (
                      <div style={{ marginTop: 12 }}>
                        <button style={btnSmall} onClick={() => { copyToClipboard(getLinkUrl(pp.settlement_token!, 'settlement')); }}>정산 링크 복사</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          );
        })()}
        {/* Copy toast */}
        {copyToast && (
          <div style={{ position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)', background: '#1A1D21', color: '#fff', padding: '8px 20px', borderRadius: 8, fontSize: 14, zIndex: 300, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
            복사됨
          </div>
        )}

        {/* Manage toast with undo */}
        {manageToast && (
          <div style={{ position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)', background: '#1A1D21', color: '#fff', padding: '8px 20px', borderRadius: 8, fontSize: 14, zIndex: 300, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', gap: 12 }}>
            {manageToast.message}
            {manageToast.undoAction && (
              <button
                onClick={() => { manageToast.undoAction!(); setManageToast(null); }}
                style={{ background: 'none', border: 'none', color: '#7CB3F0', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)', whiteSpace: 'nowrap' }}
              >
                실행 취소
              </button>
            )}
          </div>
        )}

        {/* Undo step confirmation modal */}
        {undoConfirmModal && (
          <div style={modalOverlay} onMouseDown={(e) => { mouseDownRef.current = e.target; }} onClick={(e) => { if (e.target === e.currentTarget && mouseDownRef.current === e.currentTarget) { setUndoConfirmModal(null); } }}>
            <div style={{ ...modalContent, width: 400 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
                {undoConfirmModal.stepLabel} 수령 기록을 취소하시겠습니까?
              </h2>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
                저장된 링크도 함께 삭제됩니다
              </p>
              {undoConfirmError && (
                <div style={{ padding: '8px 12px', background: '#FEF2F2', color: '#B03F3B', borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
                  {undoConfirmError}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button style={btnGhost} onClick={() => setUndoConfirmModal(null)} disabled={undoConfirmLoading}>취소</button>
                <button
                  style={{ ...btnPrimary, background: '#B03F3B' }}
                  onClick={handleUndoStepConfirm}
                  disabled={undoConfirmLoading}
                >
                  {undoConfirmLoading ? '처리 중...' : '확인'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit step modal (receive modal for edit/create) */}
        {editStepModal && (
          <div style={modalOverlay} onMouseDown={(e) => { mouseDownRef.current = e.target; }} onClick={(e) => { if (e.target === e.currentTarget && mouseDownRef.current === e.currentTarget) { setEditStepModal(null); } }}>
            <div style={{ ...modalContent, width: 480 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
                {editStepModal.stepLabel} {editStepModal.link || editStepModal.fileUrl || editStepModal.noLink ? '수정' : '수령'}
              </h2>

              {/* File upload for edit (가편집본) step */}
              {editStepModal.step === 'edit' && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, display: 'block', color: 'var(--text-secondary)' }}>
                    파일 업로드 (MOV/MP4)
                  </label>
                  {editStepModal.fileUrl ? (
                    <div style={{ padding: '10px 12px', background: '#F2F4F7', borderRadius: 8, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span>{editStepModal.originalFilename} ({formatFileSize(editStepModal.fileSize)})</span>
                      <button
                        onClick={() => setEditStepModal({ ...editStepModal, fileUrl: '', originalFilename: '', mimeType: '', fileSize: 0, noLink: false })}
                        style={{ fontSize: 11, padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 4, background: '#fff', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font)' }}
                      >삭제</button>
                    </div>
                  ) : (
                    <div
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const file = e.dataTransfer.files[0];
                        if (file) handleEditStepFileUpload(file);
                      }}
                      onClick={() => fileInputRef.current?.click()}
                      style={{ padding: '20px 16px', border: '2px dashed var(--border)', borderRadius: 8, textAlign: 'center', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13 }}
                    >
                      {editStepUploading ? '업로드 중...' : '파일을 드래그하거나 클릭해서 업로드 (최대 100MB)'}
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".mov,.mp4,video/*"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleEditStepFileUpload(file);
                      e.target.value = '';
                    }}
                  />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    또는 링크로 제출할 수 있습니다
                  </div>
                </div>
              )}

              {/* Link URL - shown for draft/upload, or edit when no file */}
              {(editStepModal.step !== 'edit' || !editStepModal.fileUrl) && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, display: 'block', color: 'var(--text-secondary)' }}>
                    {editStepModal.step === 'upload' ? '콘텐츠 URL' : '링크 URL'} {!editStepModal.noLink && !editStepModal.fileUrl && <span style={{ color: '#B03F3B' }}>*</span>}
                  </label>
                  <input
                    type="url"
                    placeholder="https://"
                    value={editStepModal.link}
                    onChange={(e) => setEditStepModal({ ...editStepModal, link: e.target.value })}
                    disabled={editStepModal.noLink && !editStepModal.fileUrl}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontFamily: 'var(--font)', boxSizing: 'border-box', background: editStepModal.noLink && !editStepModal.fileUrl ? '#F2F4F7' : '#fff' }}
                  />
                </div>
              )}

              {/* Content type for upload (최종 업로드) step */}
              {editStepModal.step === 'upload' && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, display: 'block', color: 'var(--text-secondary)' }}>
                    콘텐츠 유형 <span style={{ color: '#B03F3B' }}>*</span>
                  </label>
                  <select
                    value={editStepModal.contentType}
                    onChange={(e) => setEditStepModal({ ...editStepModal, contentType: e.target.value })}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontFamily: 'var(--font)', boxSizing: 'border-box', background: '#fff' }}
                  >
                    <option value="">선택하세요</option>
                    {Object.entries(FINAL_CONTENT_TYPES).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Received date */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, display: 'block', color: 'var(--text-secondary)' }}>
                  {editStepModal.step === 'upload' ? '확인일' : '수령일'}
                </label>
                <input
                  type="date"
                  value={editStepModal.receivedDate}
                  onChange={(e) => setEditStepModal({ ...editStepModal, receivedDate: e.target.value })}
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontFamily: 'var(--font)', boxSizing: 'border-box' }}
                />
              </div>

              {/* Memo */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, display: 'block', color: 'var(--text-secondary)' }}>메모</label>
                <input
                  type="text"
                  placeholder="선택 사항"
                  value={editStepModal.memo}
                  onChange={(e) => setEditStepModal({ ...editStepModal, memo: e.target.value })}
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontFamily: 'var(--font)', boxSizing: 'border-box' }}
                />
              </div>

              {/* Process type (not shown for upload step) */}
              {editStepModal.step !== 'upload' && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 6, display: 'block', color: 'var(--text-secondary)' }}>처리</label>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 13 }}>
                      <input type="radio" name="editStepProcessType" checked={editStepModal.processType === 'approved'} onChange={() => setEditStepModal({ ...editStepModal, processType: 'approved' })} />
                      컨펌 완료
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 13 }}>
                      <input type="radio" name="editStepProcessType" checked={editStepModal.processType === 'revision_requested'} onChange={() => setEditStepModal({ ...editStepModal, processType: 'revision_requested' })} />
                      수정 요청
                    </label>
                  </div>
                </div>
              )}

              {/* Revision category */}
              {editStepModal.processType === 'revision_requested' && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 6, display: 'block', color: 'var(--text-secondary)' }}>
                    수정 카테고리
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {REVIEW_CATEGORIES.map((cat) => (
                      <label key={cat} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                        <input
                          type="radio"
                          name="reviewCategory"
                          checked={editStepModal.reviewCategory === cat}
                          onChange={() => setEditStepModal({ ...editStepModal, reviewCategory: cat })}
                        />
                        {cat}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Revision note */}
              {editStepModal.processType === 'revision_requested' && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, display: 'block', color: 'var(--text-secondary)' }}>
                    수정 요청 사유 <span style={{ color: '#B03F3B' }}>*</span>
                  </label>
                  <textarea
                    placeholder="수정이 필요한 부분을 적어주세요"
                    value={editStepModal.revisionNote}
                    onChange={(e) => setEditStepModal({ ...editStepModal, revisionNote: e.target.value })}
                    rows={3}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontFamily: 'var(--font)', boxSizing: 'border-box', resize: 'vertical' }}
                  />
                </div>
              )}

              {/* No-link checkbox (only for draft/edit, not upload) */}
              {editStepModal.step !== 'upload' && !editStepModal.fileUrl && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 16 }}>
                  <input
                    type="checkbox"
                    checked={editStepModal.noLink}
                    onChange={(e) => setEditStepModal({ ...editStepModal, noLink: e.target.checked, link: e.target.checked ? '' : editStepModal.link })}
                    style={{ width: 14, height: 14 }}
                  />
                  링크 없이 확인함
                </label>
              )}

              {/* Error */}
              {editStepError && (
                <div style={{ padding: '8px 12px', background: '#FEF2F2', color: '#B03F3B', borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
                  {editStepError}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button style={btnGhost} onClick={() => setEditStepModal(null)} disabled={editStepSaving || editStepUploading}>취소</button>
                <button style={btnPrimary} onClick={handleEditStepSave} disabled={editStepSaving || editStepUploading}>
                  {editStepSaving ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Reset confirmation modal */}
        {resetModal && (
          <div style={modalOverlay} onMouseDown={(e) => { mouseDownRef.current = e.target; }} onClick={(e) => { if (e.target === e.currentTarget && mouseDownRef.current === e.currentTarget) { setResetModal(null); } }}>
            <div style={{ ...modalContent, width: 440 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
                {resetModal.type === 'participant' ? '모든 진행 기록 초기화' : '모든 참여자 진행 초기화'}
              </h2>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>
                {resetModal.type === 'participant'
                  ? '이 참여자의 기획안·가편집본·업로드 기록이 모두 삭제됩니다.'
                  : '이 캠페인의 모든 참여자 기획안·가편집본·업로드 기록이 삭제됩니다.'}
              </p>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                동의서·정산 정보·일정은 유지됩니다.
              </p>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, display: 'block', color: 'var(--text-secondary)' }}>
                  확인을 위해 <strong>{resetModal.confirmName}</strong>을(를) 입력하세요
                </label>
                <input
                  type="text"
                  placeholder={resetModal.confirmName}
                  value={resetConfirmInput}
                  onChange={(e) => setResetConfirmInput(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontFamily: 'var(--font)', boxSizing: 'border-box' }}
                />
              </div>
              {resetError && (
                <div style={{ padding: '8px 12px', background: '#FEF2F2', color: '#B03F3B', borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
                  {resetError}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button style={btnGhost} onClick={() => { setResetModal(null); setResetConfirmInput(''); }} disabled={resetLoading}>취소</button>
                <button
                  style={{ ...btnPrimary, background: '#B03F3B', opacity: resetConfirmInput !== resetModal.confirmName ? 0.4 : 1 }}
                  onClick={handleResetConfirm}
                  disabled={resetLoading || resetConfirmInput !== resetModal.confirmName}
                >
                  {resetLoading ? '처리 중...' : '초기화'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
