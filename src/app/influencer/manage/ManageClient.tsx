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
  isPaidCollab,
  getSettlementStatus,
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
} from '@/lib/types/influencer';

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
  _deliverables?: Record<string, { link_url?: string; memo?: string; status?: string; received_at?: string; version?: number }>;
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
    noLink: boolean;
  } | null>(null);
  const [editStepSaving, setEditStepSaving] = useState(false);
  const [editStepError, setEditStepError] = useState('');

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

  const fetchCampaigns = async () => {
    try {
      const url = filter === 'all' ? '/api/influencer/campaigns' : `/api/influencer/campaigns?status=${filter}`;
      const res = await fetch(url);
      const data = await res.json();
      setCampaigns(Array.isArray(data) ? data : []);
    } catch {
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCampaigns(); }, [filter]);

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
        const key = undoConfirmModal.step === 'draft' ? 'draft_received_at' : 'edit_received_at';
        const updated = { ...detailPart, [key]: null };
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

  // Handle edit step save
  const handleEditStepSave = async () => {
    if (!editStepModal) return;
    if (!editStepModal.noLink && !editStepModal.link.trim()) {
      setEditStepError('링크를 입력하세요');
      return;
    }
    if (editStepModal.processType === 'revision_requested' && !editStepModal.revisionNote.trim()) {
      setEditStepError('수정 요청 사유를 입력하세요');
      return;
    }
    setEditStepSaving(true);
    setEditStepError('');
    try {
      const res = await fetch('/api/influencer/participants/check-step', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participant_id: editStepModal.participantId,
          step: editStepModal.step,
          link: editStepModal.noLink ? '' : editStepModal.link.trim(),
          memo: editStepModal.memo.trim(),
          received_at: editStepModal.receivedDate ? new Date(editStepModal.receivedDate + 'T00:00:00+09:00').toISOString() : undefined,
          status: editStepModal.processType,
          revision_note: editStepModal.processType === 'revision_requested' ? editStepModal.revisionNote.trim() : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '알 수 없는 오류' }));
        setEditStepError(err.error || '저장에 실패했습니다');
        return;
      }
      const result = await res.json();
      fetchCampaigns();
      if (detailPart?.id === editStepModal.participantId) {
        const key = editStepModal.step === 'draft' ? 'draft_received_at' : 'edit_received_at';
        const updated = { ...detailPart };
        if (editStepModal.processType !== 'revision_requested') {
          (updated as Record<string, unknown>)[key] = result.value;
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
          : `${editStepModal.stepLabel} 수정 완료`,
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

  const fmtKRW = (n: number) => n > 0 ? `₩${n.toLocaleString()}` : '-';

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
    const uploadDone = !!p.published_url;
    const stage = getSettlementStatus(p);
    const paidDone = stage === 'paid';
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

  /* ── Column widths (7 columns) ────────────────────────── */
  const colW = {
    name: '22%', product: '16%', fee: '12%',
    status: '14%', progress: '20%', nextAction: '12%', menu: '4%',
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

        {campaigns.map((c) => {
          const isOpen = expanded.has(c.id);
          const parts = c.inf_participants ?? [];
          const totalFee = parts.reduce((s, p) => s + (p.fee || 0), 0);
          const allUnpaid = parts.length > 0 && parts.every((p) => !isPaidCollab(p.collab_type) && (p.fee || 0) === 0);
          const consentAgreed = parts.filter((p) => p.consent_status === 'agreed').length;
          const uploadDone = parts.filter((p) => !!p.published_url).length;
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
                      {` · 동의서 ${consentAgreed}/${parts.length}`}
                      {` · 업로드 ${uploadDone}/${parts.length}`}
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
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                    <button style={btnGhost} onClick={() => openAddParticipant(c.id)}>+ 참여자 추가</button>
                  </div>
                  {parts.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>참여자가 없습니다</p>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table className="data-table" style={{ width: '100%', fontSize: 13, tableLayout: 'fixed' }}>
                        <colgroup>
                          <col style={{ width: colW.name }} />
                          <col style={{ width: colW.product }} />
                          {!allUnpaid && <col style={{ width: colW.fee }} />}
                          <col style={{ width: colW.status }} />
                          <col style={{ width: colW.progress }} />
                          <col style={{ width: colW.nextAction }} />
                          <col style={{ width: colW.menu }} />
                        </colgroup>
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'left' }}>인플루언서</th>
                            <th style={{ textAlign: 'left' }}>제공제품</th>
                            {!allUnpaid && <th style={{ textAlign: 'right' }}>고료</th>}
                            <th style={{ textAlign: 'left' }}>상태</th>
                            <th style={{ textAlign: 'center' }}>진행</th>
                            <th style={{ textAlign: 'left' }}>다음 작업</th>
                            <th style={{ width: colW.menu }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {parts.map((p) => {
                            const nextAction = getNextAction(p, c);
                            return (
                              <tr key={p.id}>
                                {/* 인플루언서: 2-line (name + channel/content) */}
                                <td style={{ textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  <div style={{ fontWeight: 500, color: (p.name || p.display_name) ? '#1A1D21' : '#9AA2AA', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                                    onClick={() => { setDetailPart(p); setDetailCampaign(c); }}>
                                    {p.name || p.display_name || '(채널명 미입력)'}
                                    {p.memo && <MemoIcon hasMemo size={10} />}
                                  </div>
                                  <div style={{ fontSize: 11, color: '#9AA2AA', marginTop: 1 }}>
                                    {[p.handle ? `@${p.handle}` : null, p.channel ? CHANNEL_LABELS[p.channel] : null].filter(Boolean).join(' · ')}
                                  </div>
                                </td>
                                {/* 제공제품 */}
                                <td style={{ textAlign: 'left', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {p.product_set_name || p.product || '-'}
                                </td>
                                {/* 고료 */}
                                {!allUnpaid && (
                                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                    {isPaidCollab(p.collab_type) || (p.fee || 0) > 0
                                      ? fmtKRW(p.fee)
                                      : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>-</span>}
                                  </td>
                                )}
                                {/* 상태 (custom dropdown) */}
                                <td style={{ textAlign: 'left' }} onClick={(e) => e.stopPropagation()}>
                                  <CustomSelect
                                    value={p.status}
                                    onChange={(v) => handleUpdateParticipant(p.id, { status: v })}
                                    options={Object.entries(PARTICIPANT_STATUS_LABELS).map(([k, v]) => ({ value: k, label: v }))}
                                  />
                                </td>
                                {/* 진행 (3-stage dots) */}
                                <td style={{ textAlign: 'center' }}>
                                  <ProgressDots p={p} />
                                </td>
                                {/* 다음 작업 */}
                                <td style={{ textAlign: 'left' }}>
                                  {nextAction ? (
                                    <button
                                      style={btnSmall}
                                      onClick={(e) => { e.stopPropagation(); nextAction.onClick(); }}
                                    >
                                      {nextAction.label}
                                    </button>
                                  ) : (
                                    <span style={{ fontSize: 12, color: '#C4CAD1' }}>-</span>
                                  )}
                                </td>
                                {/* ⋯ menu */}
                                <td style={{ textAlign: 'center', position: 'relative' }}>
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
                const dlv = detailPart._deliverables || {};

                type Dlv = { link_url?: string; memo?: string; status?: string; received_at?: string; revision_note?: string; version?: number };
                type StepDef = { key: string; step: string; label: string; value: string | null; deliverable?: Dlv; disabled?: boolean; editable?: boolean; dateLabel?: string };
                const steps: StepDef[] = [];

                // Consent (non-uncheckable)
                if (detailPart.consent_agreed_at) {
                  steps.push({
                    key: 'consent',
                    step: 'consent',
                    label: '동의서',
                    value: detailPart.consent_agreed_at,
                    disabled: true,
                    dateLabel: `회수 ${new Date(detailPart.consent_agreed_at).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })}`,
                  });
                }

                // Draft / Edit
                if (paid) {
                  const draftDlv = dlv.draft;
                  steps.push({
                    key: 'draft_received_at',
                    step: 'draft',
                    label: '기획안',
                    value: detailPart.draft_received_at,
                    deliverable: draftDlv,
                    editable: !!detailPart.draft_received_at,
                    dateLabel: detailPart.draft_received_at
                      ? `수령 ${new Date(detailPart.draft_received_at).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })}`
                      : detailPart.planned_draft_date ? `예정 ${detailPart.planned_draft_date}` : undefined,
                  });
                  const editDlv = dlv.edit;
                  steps.push({
                    key: 'edit_received_at',
                    step: 'edit',
                    label: '가편집본',
                    value: detailPart.edit_received_at,
                    deliverable: editDlv,
                    editable: !!detailPart.edit_received_at,
                    dateLabel: detailPart.edit_received_at
                      ? `수령 ${new Date(detailPart.edit_received_at).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })}`
                      : detailPart.planned_edit_date ? `예정 ${detailPart.planned_edit_date}` : undefined,
                  });
                }

                // Upload
                steps.push({
                  key: 'uploaded_at',
                  step: 'upload',
                  label: '업로드',
                  value: detailPart.uploaded_at,
                  dateLabel: detailPart.uploaded_at
                    ? `확인 ${new Date(detailPart.uploaded_at).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })}`
                    : detailPart.planned_upload_date ? `예정 ${detailPart.planned_upload_date}` : undefined,
                });

                // Payment
                if (paid) {
                  const isPaid = detailPart.settlement_status === 'paid';
                  steps.push({
                    key: 'payment',
                    step: 'payment',
                    label: '지급',
                    value: isPaid ? 'paid' : null,
                    disabled: true,
                    dateLabel: isPaid ? '완료' : undefined,
                  });
                }

                return (
                  <div style={{ marginBottom: 16, fontSize: 13 }}>
                    <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>진행</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {steps.map((s) => (
                        <div key={s.key}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 26 }}>
                            <input
                              type="checkbox"
                              checked={!!s.value}
                              disabled={s.disabled}
                              onChange={() => {
                                if (s.disabled) return;
                                if (s.value) {
                                  // Uncheck: show confirmation modal (for draft/edit only via check-step, upload via direct update)
                                  if (s.step === 'draft' || s.step === 'edit') {
                                    setUndoConfirmModal({ participantId: detailPart.id, step: s.step, stepLabel: s.label });
                                    setUndoConfirmError('');
                                  } else if (s.step === 'upload') {
                                    // Check cascade: block if payment is done
                                    if (detailPart.settlement_status === 'paid') {
                                      setErrorMsg('지급 완료 상태에서는 업로드를 취소할 수 없습니다');
                                      setTimeout(() => setErrorMsg(''), 4000);
                                      return;
                                    }
                                    setUndoConfirmModal({ participantId: detailPart.id, step: 'upload', stepLabel: '업로드' });
                                    setUndoConfirmError('');
                                  }
                                } else {
                                  // Check: for draft/edit, this would normally open the receive modal from dashboard
                                  // Here we just do a simple check via check-step API
                                  if (s.step === 'draft' || s.step === 'edit') {
                                    const kst = new Date(Date.now() + 9 * 3600000);
                                    const today = kst.toISOString().slice(0, 10);
                                    setEditStepModal({
                                      participantId: detailPart.id,
                                      step: s.step,
                                      stepLabel: s.label,
                                      link: '',
                                      receivedDate: today,
                                      memo: '',
                                      processType: 'approved',
                                      revisionNote: '',
                                      noLink: false,
                                    });
                                    setEditStepError('');
                                  } else if (s.step === 'upload') {
                                    handleUpdateParticipant(detailPart.id, {
                                      uploaded_at: new Date().toISOString(),
                                    });
                                  }
                                }
                              }}
                              style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: s.disabled ? 'default' : 'pointer' }}
                            />
                            <span style={{ color: s.value ? 'var(--text-secondary)' : 'var(--text-muted)', flex: 1 }}>
                              {s.label}
                              {s.dateLabel && (
                                <span style={{ fontSize: 11, color: 'var(--text-info)', marginLeft: 6 }}>{s.dateLabel}</span>
                              )}
                            </span>
                            {s.editable && (s.step === 'draft' || s.step === 'edit') && (
                              <button
                                onClick={() => {
                                  const d = s.deliverable;
                                  const kst = new Date(Date.now() + 9 * 3600000);
                                  const today = kst.toISOString().slice(0, 10);
                                  setEditStepModal({
                                    participantId: detailPart.id,
                                    step: s.step,
                                    stepLabel: s.label,
                                    link: d?.link_url || '',
                                    receivedDate: d?.received_at ? new Date(d.received_at).toISOString().slice(0, 10) : today,
                                    memo: d?.memo || '',
                                    processType: (d?.status === 'revision_requested' ? 'revision_requested' : 'approved'),
                                    revisionNote: d?.revision_note || '',
                                    noLink: !d?.link_url,
                                  });
                                  setEditStepError('');
                                }}
                                style={{ fontSize: 11, padding: '1px 8px', border: '1px solid var(--border)', borderRadius: 4, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font)', flexShrink: 0 }}
                              >
                                수정
                              </button>
                            )}
                          </div>
                          {/* Deliverable link */}
                          {s.deliverable?.link_url && (
                            <div style={{ marginLeft: 20, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                              <a
                                href={s.deliverable.link_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ fontSize: 12, color: '#4A7DB5', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}
                              >
                                {s.deliverable.link_url}
                              </a>
                              <button
                                onClick={() => copyToClipboard(s.deliverable!.link_url!)}
                                style={{ fontSize: 11, padding: '1px 6px', border: '1px solid var(--border)', borderRadius: 4, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font)', flexShrink: 0 }}
                              >복사</button>
                              <a
                                href={s.deliverable.link_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ fontSize: 11, padding: '1px 6px', border: '1px solid var(--border)', borderRadius: 4, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font)', textDecoration: 'none', flexShrink: 0 }}
                              >열기</a>
                            </div>
                          )}
                          {/* Deliverable memo */}
                          {s.deliverable?.memo && (
                            <div style={{ marginLeft: 20, marginTop: 2, fontSize: 12, color: 'var(--text-muted)' }}>
                              메모: {s.deliverable.memo}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
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
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>정산</h3>
                <div style={{ display: 'flex', gap: 16, fontSize: 13, marginBottom: 12 }}>
                  <div><span style={{ color: 'var(--text-info)' }}>상태:</span> {SETTLEMENT_STAGE_LABELS[getSettlementStatus(detailPart)]}</div>
                </div>
                {(isPaidCollab(detailPart.collab_type) || isPaidCollab(detailCampaign?.collab_type) || (detailPart.fee || 0) > 0) ? (
                  <div>
                    {detailPart.settlement_token ? (
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
                ) : (
                  <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>무가 협업 - 정산 해당 없음</p>
                )}
              </div>
            </div>
          </>
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
            <div style={{ ...modalContent, width: 440 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
                {editStepModal.stepLabel} {editStepModal.link || editStepModal.noLink ? '수정' : '수령'}
              </h2>

              {/* Link URL */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, display: 'block', color: 'var(--text-secondary)' }}>
                  링크 URL {!editStepModal.noLink && <span style={{ color: '#B03F3B' }}>*</span>}
                </label>
                <input
                  type="url"
                  placeholder="https://"
                  value={editStepModal.link}
                  onChange={(e) => setEditStepModal({ ...editStepModal, link: e.target.value })}
                  disabled={editStepModal.noLink}
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontFamily: 'var(--font)', boxSizing: 'border-box', background: editStepModal.noLink ? '#F2F4F7' : '#fff' }}
                />
              </div>

              {/* Received date */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, display: 'block', color: 'var(--text-secondary)' }}>수령일</label>
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

              {/* Process type */}
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

              {/* No-link checkbox */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 16 }}>
                <input
                  type="checkbox"
                  checked={editStepModal.noLink}
                  onChange={(e) => setEditStepModal({ ...editStepModal, noLink: e.target.checked, link: e.target.checked ? '' : editStepModal.link })}
                  style={{ width: 14, height: 14 }}
                />
                링크 없이 확인함
              </label>

              {/* Error */}
              {editStepError && (
                <div style={{ padding: '8px 12px', background: '#FEF2F2', color: '#B03F3B', borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
                  {editStepError}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button style={btnGhost} onClick={() => setEditStepModal(null)} disabled={editStepSaving}>취소</button>
                <button style={btnPrimary} onClick={handleEditStepSave} disabled={editStepSaving}>
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
