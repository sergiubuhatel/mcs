import CompanyFilters from "../features/companies/CompanyFilters";
import CompanyTable from "../features/companies/CompanyTable";
import ScreenerForecastBar from "../features/companies/ScreenerForecastBar";

export default function ScreenerPage() {
  return (
    <div>
      <CompanyFilters />
      <ScreenerForecastBar />
      <CompanyTable />
    </div>
  );
}
