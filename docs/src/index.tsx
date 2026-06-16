/* @refresh reload */
import { render } from "solid-js/web";
import { HashRouter, Route } from "@solidjs/router";
import { App } from "./App";
import Home from "./pages/Home";
import GettingStarted from "./pages/GettingStarted";
import ButtonPage from "./pages/ButtonPage";
import ModalPage from "./pages/ModalPage";
import ClientPickerPage from "./pages/ClientPickerPage";
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
import { installDocsFetchMock } from "./mocks/fetch";
import "./tailwind.css";
import "./styles.css";
// Real kserp brand CSS so the host kit (Button HUD effects, Modal surfaces)
// renders exactly like the live app.
import "./host-kit/button.css";
import "./host-kit/brand.css";

// Docs has no backend, so populate the ERP pickers with sample data before
// the app mounts. Must run before any component fires its first fetch.
installDocsFetchMock();

const root = document.getElementById("root");

// Hash routing sidesteps the GitHub Pages deep link 404 problem entirely.
render(
  () => (
    <HashRouter root={App}>
      <Route path="/" component={Home} />
      <Route path="/getting-started" component={GettingStarted} />
      <Route path="/components/button" component={ButtonPage} />
      <Route path="/components/modal" component={ModalPage} />
      <Route path="/components/client-picker" component={ClientPickerPage} />
      <Route path="/components/markdown-notes" component={MarkdownNotesPage} />
      <Route path="/components/mention-textarea" component={MentionTextareaPage} />
      <Route path="/components/voucher-picker" component={VoucherPickerPage} />
      <Route path="/components/camera-capture" component={CameraCapturePage} />
      <Route path="/components/add-attachment-tile" component={AddAttachmentTilePage} />
      <Route path="/components/payment-account-picker" component={PaymentAccountPickerPage} />
      <Route path="/components/account-avatar" component={AccountAvatarPage} />
      <Route path="/components/existing-attachment-tile" component={ExistingAttachmentTilePage} />
      <Route path="/components/account-icons" component={AccountIconsPage} />
      <Route path="/components/build-logo-src" component={BuildLogoSrcPage} />
      <Route path="/components/attachment-url" component={AttachmentUrlPage} />
      <Route path="/components/use-accounts-index" component={UseAccountsIndexPage} />
      <Route path="/components/form-field" component={FormFieldPage} />
      <Route path="/components/detail-row" component={DetailRowPage} />
      <Route path="/components/date-tile" component={DateTilePage} />
      <Route path="/components/tooltip" component={TooltipPage} />
      <Route path="/components/image-cropper" component={ImageCropperPage} />
      <Route path="/components/progress-bar" component={ProgressBarPage} />
      <Route path="/components/chart-legend" component={ChartLegendPage} />
      <Route path="/components/status-pill" component={StatusPillPage} />
      <Route path="/components/segmented-filter" component={SegmentedFilterPage} />
      <Route path="/components/copy-button" component={CopyButtonPage} />
      <Route path="/components/kpi-card" component={KpiCardPage} />
      <Route path="/components/radio-card-group" component={RadioCardGroupPage} />
      <Route path="/components/form-error-banner" component={FormErrorBannerPage} />
      <Route path="/components/tag-pill" component={TagPillPage} />
      <Route path="/components/live-timer" component={LiveTimerPage} />
      <Route path="/components/secret-reveal" component={SecretRevealPage} />
      <Route path="/components/form-actions" component={FormActionsPage} />
      <Route path="/utils/format-php" component={FormatPHPPage} />
      <Route path="/utils/format-short-date" component={FormatShortDatePage} />
      <Route path="/utils/format-full-date" component={FormatFullDatePage} />
    </HashRouter>
  ),
  root!,
);
