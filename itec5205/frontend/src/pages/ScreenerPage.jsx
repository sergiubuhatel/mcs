import CompanyFilters from "../features/companies/CompanyFilters";
import CompanyTable from "../features/companies/CompanyTable";
import ScreenerForecastBar from "../features/companies/ScreenerForecastBar";
import SavePoolForm from "../features/pools/SavePoolForm";

export default function ScreenerPage() {
  return (
    <div>
      <CompanyFilters />
      <SavePoolForm />
      <ScreenerForecastBar />
      <CompanyTable />
    </div>
  );
}
