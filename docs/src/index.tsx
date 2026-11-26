/* @refresh reload */
import { render } from "@solidjs/web";
import { createRouter, hashHistory } from "@solidjs/router";
import { App } from "./App";
import Home from "./pages/Home";
import GettingStarted from "./pages/GettingStarted";
import ModalPage from "./pages/ModalPage";
import EntityPickerPage from "./pages/EntityPickerPage";
import ClientPickerPage from "./pages/ClientPickerPage";
import PayeePickerPage from "./pages/PayeePickerPage";
import ComboBoxPage from "./pages/ComboBoxPage";
import MarkdownNotesPage from "./pages/MarkdownNotesPage";
import MentionTextareaPage from "./pages/MentionTextareaPage";
import VoucherPickerPage from "./pages/VoucherPickerPage";
import CameraCapturePage from "./pages/CameraCapturePage";
import AddAttachmentTilePage from "./pages/AddAttachmentTilePage";
import PaymentAccountPickerPage from "./pages/PaymentAccountPickerPage";
import AccountAvatarPage from "./pages/AccountAvatarPage";
import ExistingAttachmentTilePage from "./pages/ExistingAttachmentTilePage";
import AccountIconsPage from "./pages/AccountIconsPage";
import BuildLogoSrcPage from "./pages/BuildLogoSrcPage";
import AttachmentUrlPage from "./pages/AttachmentUrlPage";
import UseAccountsIndexPage from "./pages/UseAccountsIndexPage";
import FormFieldPage from "./pages/FormFieldPage";
import DetailRowPage from "./pages/DetailRowPage";
import DateTilePage from "./pages/DateTilePage";
import TooltipPage from "./pages/TooltipPage";
import ImageCropperPage from "./pages/ImageCropperPage";
import ProgressBarPage from "./pages/ProgressBarPage";
import ChartLegendPage from "./pages/ChartLegendPage";
import StatusPillPage from "./pages/StatusPillPage";
import SegmentedFilterPage from "./pages/SegmentedFilterPage";
import CopyButtonPage from "./pages/CopyButtonPage";
import KpiCardPage from "./pages/KpiCardPage";
import RadioCardGroupPage from "./pages/RadioCardGroupPage";
import FormErrorBannerPage from "./pages/FormErrorBannerPage";
import TagPillPage from "./pages/TagPillPage";
import LiveTimerPage from "./pages/LiveTimerPage";
import SecretRevealPage from "./pages/SecretRevealPage";
import FormActionsPage from "./pages/FormActionsPage";
import FormatPHPPage from "./pages/formatPHPPage";
import FormatShortDatePage from "./pages/formatShortDatePage";
import FormatFullDatePage from "./pages/formatFullDatePage";
import ButtonHudPage from "./pages/ButtonHudPage";
import ThemeTogglePage from "./pages/ThemeTogglePage";
import DropdownPage from "./pages/DropdownPage";
import SocialLinksBarPage from "./pages/SocialLinksBarPage";
import StatusIndicatorPage from "./pages/StatusIndicatorPage";
import SectionHeadingPage from "./pages/SectionHeadingPage";
import NotFoundPage from "./pages/NotFoundPage";
import EyebrowBadgePage from "./pages/EyebrowBadgePage";
import { installDocsFetchMock } from "./mocks/fetch";
import "./tailwind.css";
import "./styles.css";
// Brand CSS providing the docs theme tokens and utility classes (card-bg,
// page-bg, theme-toggle, HUD effects) that the docs site styles itself with.
import "./host-kit/button.css";
import "./host-kit/brand.css";

// Docs has no backend, so populate the ERP pickers with sample data before
// the app mounts. Must run before any component fires its first fetch.
installDocsFetchMock();

const root = document.getElementById("root");

// Hash routing sidesteps the GitHub Pages deep link 404 problem entirely.
const Router = createRouter({
  history: hashHistory(),
  routes: [
    { path: "/", component: Home },
    { path: "/getting-started", component: GettingStarted },
    { path: "/components/button", component: ButtonHudPage },
    { path: "/components/modal", component: ModalPage },
    { path: "/components/entity-picker", component: EntityPickerPage },
    { path: "/components/client-picker", component: ClientPickerPage },
    { path: "/components/payee-picker", component: PayeePickerPage },
    { path: "/components/combo-box", component: ComboBoxPage },
    { path: "/components/markdown-notes", component: MarkdownNotesPage },
    { path: "/components/mention-textarea", component: MentionTextareaPage },
    { path: "/components/voucher-picker", component: VoucherPickerPage },
    { path: "/components/camera-capture", component: CameraCapturePage },
    { path: "/components/add-attachment-tile", component: AddAttachmentTilePage },
    { path: "/components/payment-account-picker", component: PaymentAccountPickerPage },
    { path: "/components/account-avatar", component: AccountAvatarPage },
    { path: "/components/existing-attachment-tile", component: ExistingAttachmentTilePage },
    { path: "/components/account-icons", component: AccountIconsPage },
    { path: "/components/build-logo-src", component: BuildLogoSrcPage },
    { path: "/components/attachment-url", component: AttachmentUrlPage },
    { path: "/components/use-accounts-index", component: UseAccountsIndexPage },
    { path: "/components/form-field", component: FormFieldPage },
    { path: "/components/detail-row", component: DetailRowPage },
    { path: "/components/date-tile", component: DateTilePage },
    { path: "/components/tooltip", component: TooltipPage },
    { path: "/components/image-cropper", component: ImageCropperPage },
    { path: "/components/progress-bar", component: ProgressBarPage },
    { path: "/components/chart-legend", component: ChartLegendPage },
    { path: "/components/status-pill", component: StatusPillPage },
    { path: "/components/segmented-filter", component: SegmentedFilterPage },
    { path: "/components/copy-button", component: CopyButtonPage },
    { path: "/components/kpi-card", component: KpiCardPage },
    { path: "/components/radio-card-group", component: RadioCardGroupPage },
    { path: "/components/form-error-banner", component: FormErrorBannerPage },
    { path: "/components/tag-pill", component: TagPillPage },
    { path: "/components/live-timer", component: LiveTimerPage },
    { path: "/components/secret-reveal", component: SecretRevealPage },
    { path: "/components/form-actions", component: FormActionsPage },
    { path: "/utils/format-php", component: FormatPHPPage },
    { path: "/utils/format-short-date", component: FormatShortDatePage },
    { path: "/utils/format-full-date", component: FormatFullDatePage },
    { path: "/components/theme-toggle", component: ThemeTogglePage },
    { path: "/components/dropdown", component: DropdownPage },
    { path: "/components/social-links-bar", component: SocialLinksBarPage },
    { path: "/components/status-indicator", component: StatusIndicatorPage },
    { path: "/components/section-heading", component: SectionHeadingPage },
    { path: "/components/not-found", component: NotFoundPage },
    { path: "/components/eyebrow-badge", component: EyebrowBadgePage },
  ],
});

render(
  () => <Router>{(props) => <App {...props} />}</Router>,
  root!,
);
